// Bug reads cross the signed Worker door while remote entities stay outside
// the box graph. The declared tools exercise the same arguments as CLI/MCP.
import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ids as addresses } from '@yaks/id/graph'
import { idDoc } from '@yaks/id/vocab'
import { loadVocab } from '@yaks/vocab'
import { validateToolInput } from '@yaks/vocab/tools'
import { ram } from '@yaks/ram'
import { answerOf, runner, toolEid, worded } from '@yaks/tools'
import { valueIn } from '@yaks/tools/value'
import { door } from '../../workers/tracker/door.ts'
import { options, platform, store, vocab } from '../../workers/tracker/core.ts'
import { trackerDoc } from './vocab.ts'
import { runs, type ToolOptions } from './tools.ts'
import { routes } from './routes.ts'
import { api, asking } from '@yaks/api'
import { sign } from './ticket.ts'

let ids = [1, 2, 3, 4, 5, 6].map((n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
)
let remote = store(ram(vocab, options), { sink: () => {} })
let boxVocab = loadVocab([...vocab.docs, idDoc], vocab.keywords)
let box = graph({
  vocab: boxVocab,
  storage: ram(boxVocab, options),
  plugins: [addresses(boxVocab)],
})
await remote.graph.apply([
  ...[3, 8, 20].map((hits, i) => ({
    entity: { eid: ids[i] },
    doc: { title: `platform problem ${i}` },
    bug: { fault: `test-${i}`, hits },
    ...i == 2 ? { resolved: { cause: 'c', recur: 'r' } } : {},
  })),
  {
    entity: { eid: ids[3] },
    error: { bug: ids[1], at: '2026-10-01T00:00:00Z' },
    during: { request: ids[5] },
  },
  {
    entity: { eid: ids[5] },
    request: { method: 'GET', url: 'https://app.test/failure' },
  },
], { trusted: true })
await box.apply([{
  entity: { eid: ids[4] },
  bug: { fault: 'box', hits: 1 },
  doc: { title: 'box problem' },
}], { trusted: true })
let before = await box.read('.entity *')
let config = { remote: { url: 'https://tracker.test', secret: 'test-only' } }
let token = await sign({
  scope: platform,
  person: 'test',
  admin: true,
  exp: Date.now() / 1000 + 60,
}, config.remote.secret)
let upstream = door(remote, platform, config.remote.secret)
// A space's tracker beside the platform's, which the platform lists.
let space = '00000000-0000-4000-8000-0000000000a1'
let spaceStore = store(ram(vocab, options), { sink: () => {} })
await spaceStore.graph.apply([{
  entity: { eid: ids[2] },
  doc: { title: 'space problem' },
  bug: { fault: 'space', hits: 1 },
}], { trusted: true })
let spaceDoor = door(spaceStore, space, config.remote.secret)
let go = ((url: URL, init?: RequestInit) => {
  let at = new URL(url)
  return at.pathname == '/scopes'
    ? Promise.resolve(Response.json({ scopes: [space] }))
    : (at.searchParams.get('scope') == space ? spaceDoor : upstream)(
      new Request(url, init),
    )
}) as typeof fetch
let read = runner(box, {
  tools: loadTools(trackerDoc, runs({}, config, go)),
}).read
let ask = (name: string, args: Record<string, unknown> = {}) =>
  read({
    entity: { eid: ids[4] },
    call: { to: toolEid(name), args },
  })
let rows = (answer: Bundle[]) => valueIn(answer)?.rows as Bundle[]
// The answer as a door that sends text says it, without the runner's record.
let said = (answer: Bundle[]) => worded(answerOf(answer, ids[4]))

// Prepare the signed read once, then check both the remote result and the box.
let listed = await ask('bug_list', { source: 'yaks.app', limit: 1 })
test("platform bug list filters and sorts before its limit in each tracker, a space's naming it, without importing rows", async () => {
  let answer = listed
  equal(valueIn(answer)?.source, 'yaks.app')
  equal(
    rows(answer).map((b) => [b.entity.eid, b.$scope]),
    [[ids[1], undefined], [ids[2], space]],
  )
  ok(said(answer).includes('yaks.app'))
  equal(await box.read('.entity *'), before)
})
// The prepared read above crosses the door whole; the caller's own query is
// checked where each side decides it.
test('platform bug list sends the caller query and limit to the Worker', async () => {
  let asked: URLSearchParams | undefined
  let worker = ((url: URL) => {
    if (url.pathname == '/scopes') {
      return Promise.resolve(Response.json({ scopes: [] }))
    }
    asked = url.searchParams
    return Promise.resolve(Response.json([]))
  }) as typeof fetch
  await runs({}, config, worker).bug_list({
    entity: { eid: ids[4] },
    call: {
      args: { source: 'yaks.app', query: '.bug .order=bug.hits', limit: 2 },
    },
  }, box)
  equal([asked?.get('query'), asked?.get('limit')], [
    '.bug .order=bug.hits',
    '2',
  ])
})
test('a space tracker that cannot be read is said beside every other bug', async () => {
  let worker = ((url: URL) =>
    Promise.resolve(
      url.pathname == '/scopes'
        ? Response.json({ scopes: [space] })
        : url.searchParams.get('scope') == space
        ? new Response('', { status: 403 })
        : Response.json([{ entity: { eid: ids[1] }, bug: {} }]),
    )) as typeof fetch
  let answer = valueIn(
    await runs({}, config, worker).bug_list({
      entity: { eid: ids[4] },
      call: { args: { source: 'yaks.app' } },
    }, box),
  )
  equal((answer?.rows as Bundle[]).map((b) => b.entity.eid), [ids[1]])
  equal(answer?.unread, [
    `space ${space}: Remote tracker refused the read (403)`,
  ])
})
test("a space's bug shows from its tracker, the scope its letter names", async () => {
  let asked: URLSearchParams | undefined
  let worker = ((url: URL) => {
    asked = url.searchParams
    return Promise.resolve(Response.json({ rows: [], occurrences: 0 }))
  }) as typeof fetch
  let scope = crypto.randomUUID()
  await runs({}, config, worker).bug_show({
    entity: { eid: ids[4] },
    call: { args: { source: 'yaks.app', bug: ids[1], scope } },
  }, box)
  equal([asked?.get('scope'), asked?.get('bug')], [scope, ids[1]])
})
test("a space's bug is resolved in its tracker, the scope its letter names", async () => {
  let asked: URL | undefined
  let worker = ((url: URL) => {
    asked = url
    return Promise.resolve(Response.json({ ok: true }))
  }) as typeof fetch
  let scope = crypto.randomUUID()
  let args = { source: 'yaks.app', bug: ids[1], broke: 'b', cause: 'c' }
  await runs({}, config, worker).bug_resolve({
    entity: { eid: ids[4] },
    call: { args: { ...args, recur: 'r', scope } },
  }, box)
  equal([asked?.pathname, asked?.searchParams.get('scope')], [
    '/resolve',
    scope,
  ])
})
test('the remote store applies a caller query and order before its limit', async () =>
  equal(
    (await remote.bugs(undefined, '.bug .order=bug.hits', 2))
      .map((b) => b.entity.eid),
    [ids[0], ids[1]],
  ))
test('platform bug show reads retained occurrences without local ids or writes', async () => {
  equal(
    rows(await ask('bug_show', { source: 'yaks.app', bug: ids[1] }))
      .map((b) => b.entity.eid),
    [ids[1], ids[3], ids[5]],
  )
  equal(await box.read('.entity *'), before)
})
let boxList = await ask('bug_list')
let [boxBug] = rows(boxList)
let boxShows = await Promise.all([
  `B-${boxBug.entity.num}`,
  'box problem',
].map((bug) => ask('bug_show', { bug })))
test('box bug reads still resolve numbered ids and titles locally', async () => {
  equal(valueIn(boxList)?.source, 'box')
  equal(boxBug.entity.eid, ids[4])
  for (let answer of boxShows) {
    equal(valueIn(answer), { source: 'box', rows: [boxBug], occurrences: 0 })
    equal(JSON.parse(said(answer)), valueIn(answer))
  }
  equal(await box.read('.entity *'), before)
})
for (let source of ['box', 'yaks.app']) {
  let empty = await ask('bug_list', { source, query: '.bug.hits=999' })
  test(`${source} bug list answers an empty result as text and data`, () => {
    equal(valueIn(empty), { source, rows: [] })
    equal(JSON.parse(said(empty)), { source, rows: [] })
  })
}
test('remote reads refuse box numbers and invalid limits explicitly', async () => {
  ok(
    (await ask('bug_show', { source: 'yaks.app', bug: 'B-1' })).some((b) =>
      b.refusal
    ),
  )
  ok(
    (await ask('bug_list', { source: 'yaks.app', limit: 101 })).some((b) =>
      b.refusal
    ),
  )
})
test('a platform bug the Worker does not hold is an explicit refusal', async () =>
  ok(
    (await ask('bug_show', { source: 'yaks.app', bug: ids[4] })).some((b) =>
      b.refusal
    ),
  ))
test('platform bug reads without a configured Worker fail explicitly', async () => {
  await throws(() =>
    runs().bug_list({
      entity: { eid: ids[4] },
      call: { args: { source: 'yaks.app' } },
    }, box)
  )
})
test('the box bug door forwards app filters', async () => {
  let route = routes({}, config, go).find((r) => r.path == '/tracker/bugs')!
  let response = await route.handle(
    new Request(`http://box/tracker/bugs?app=${ids[4]}`),
  )
  equal(await response.json(), [])
})

test('empty app on the authenticated bugs door retains its all-app meaning', async () => {
  let route = routes({}, config, go).find((r) => r.path == '/tracker/bugs')!
  equal(
    (await (await route.handle(new Request('http://box/tracker/bugs?app=')))
      .json()).length,
    3,
  )
})
test('authenticated bugs reads expose no write route', async () => {
  equal(
    (await upstream(
      new Request('https://tracker.test/bugs', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    )).status,
    404,
  )
})

// Each mark fixture keeps one global bug in the Worker and, optionally, a box
// copy. Calls validate the declared inputs and apply the returned patches.
let why = {
  broke: 'Marking failed for one person.',
  cause: 'A race between two marks.',
  fix: 'f'.repeat(40),
  recur: 'No: marks are serialized.',
}
// What a Worker no attempt reaches answers each one.
let offline = Error('offline')
let marking = async (
  config: ToolOptions = {
    remote: { url: 'https://tracker.test', secret: 'test-only' },
  },
  transport?: typeof fetch,
  local = true,
  held = true,
  prior?: string,
) => {
  let worker = store(ram(vocab, options), { sink: () => {} })
  let graphOnBox = graph({
    vocab: boxVocab,
    storage: ram(boxVocab, options),
    plugins: [addresses(boxVocab)],
  })
  let bug: Bundle = {
    entity: { eid: ids[0] },
    bug: { fault: 'marked', hits: 1 },
    doc: { title: 'mark me' },
  }
  if (held) await worker.graph.apply([bug], { trusted: true })
  if (local) {
    await graphOnBox.apply([{
      ...bug,
      ...prior ? { [prior]: {} } : {},
    }], { trusted: true })
  }
  let receive = door(worker, platform, 'test-only')
  let send = transport ??
    (((url, init) => receive(new Request(url, init))) as typeof fetch)
  let tools = loadTools(trackerDoc, runs({}, config, send))
  return {
    box: graphOnBox,
    worker: worker.graph,
    // A resolution is explained, and an archival says why, unless a test says
    // otherwise.
    call: async (name: string, args: Record<string, unknown>) => {
      let tool = tools.find((t) => t.name == name)!
      let said = name == 'bug_resolve'
        ? why
        : name == 'bug_archive'
        ? { reason: 'set aside' }
        : {}
      let patches = await tool.run({
        entity: { eid: ids[4] },
        call: { args: validateToolInput(tool, { ...said, ...args }) },
      }, graphOnBox)
      await graphOnBox.apply(patches, { trusted: true })
      return patches
    },
  }
}
for (let [verb, name] of [['resolve', 'resolved'], ['archive', 'archived']]) {
  let shared = await marking()
  let [local] = await shared.box.get([ids[0]], ['entity'])
  // A configured box sends this mark once through the signed Worker door.
  let marked = await shared.call(`bug_${verb}`, {
    bug: verb == 'resolve' ? `B-${local.entity.num}` : 'mark me',
  })
  test(`box bug ${verb} marks both stores through the signed Worker door`, async () => {
    let answer = marked
    ok(answer.some((b) => b[name]))
    ok((await shared.box.get([ids[0]], [name]))[0][name])
    let [held] = await shared.worker.get([ids[0]], [name])
    ok(held[name])
    if (name == 'archived') equal((held[name] as Comp).reason, 'set aside')
    equal((await shared.worker.read('.bug.status=open')).length, 0)
  })
  if (verb == 'resolve') {
    test('a box resolution carries its explanation to both stores', async () => {
      for (let store of [shared.box, shared.worker]) {
        let [row] = await store.get([ids[0]], ['resolved'])
        equal(row.resolved, { ...row.resolved as object, ...why })
      }
    })
    let bare = await marking()
    test('a resolution without its cause and recur is refused', async () => {
      await throws(() =>
        bare.call('bug_resolve', {
          bug: ids[0],
          cause: undefined,
          recur: undefined,
        }), 'cause')
      ok(!(await bare.box.get([ids[0]], ['resolved']))[0].resolved)
    })
  }
  let retry = await marking(undefined, undefined, true, true, name)
  await retry.call(`bug_${verb}`, { bug: ids[0] })
  test(`an already marked box bug still delivers ${verb} to the Worker`, async () => {
    ok((await retry.worker.get([ids[0]], [name]))[0][name])
  })
  let boxOnly = await marking(undefined, undefined, true, false)
  await boxOnly.call(`bug_${verb}`, { bug: ids[0] })
  test(`box bug ${verb} marks locally when the Worker does not hold it`, async () => {
    ok((await boxOnly.box.get([ids[0]], [name]))[0][name])
    equal(await boxOnly.worker.read('.bug'), [])
    equal(await boxOnly.box.read('.bug.status=open'), [])
  })
  let missing = await marking(undefined, undefined, false, false)
  let missingError = await throws(
    () => missing.call(`bug_${verb}`, { bug: ids[0], source: 'yaks.app' }),
    'Remote tracker bug not found',
  )
  test(`platform bug ${verb} refuses a bug the Worker does not hold`, async () => {
    ok(String(missingError).includes('Remote tracker bug not found'))
    equal(await missing.box.read('.bug'), [])
  })
  let platformOnly = await marking(undefined, undefined, false)
  let remoteMark = await platformOnly.call(`bug_${verb}`, {
    bug: ids[0],
    source: 'yaks.app',
  })
  test(`platform bug ${verb} needs no box copy and imports no bug`, async () => {
    let answer = remoteMark
    equal(valueIn(answer), { source: 'yaks.app', bug: ids[0], mark: name })
    ok((await platformOnly.worker.get([ids[0]], [name]))[0][name])
    equal(await platformOnly.box.read('.bug'), [])
    equal((await platformOnly.worker.read('.bug.status=open')).length, 0)
  })
  test(`platform bug ${verb} refuses missing remote configuration`, async () => {
    await throws(
      () =>
        runs()[`bug_${verb}`]({
          entity: { eid: ids[4] },
          call: { args: { bug: ids[0], source: 'yaks.app' } },
        }, box),
      'Remote tracker',
    )
  })
  for (
    let [reason, settings, transport, held, said = 'Remote tracker'] of [
      [
        'unavailable',
        config,
        (() => Promise.reject(offline)) as typeof fetch,
        true,
      ],
      [
        'refused',
        config,
        ((_url, _init) =>
          Promise.resolve(
            Response.json({ error: 'denied' }, { status: 403 }),
          )) as typeof fetch,
        true,
      ],
      [
        'missing secret',
        { remote: { url: config.remote.url, secret: '' } },
        undefined,
        true,
      ],
      [
        'missing address',
        { remote: { url: '', secret: config.remote.secret } },
        undefined,
        true,
      ],
      [
        'missing Worker route',
        config,
        (() =>
          Promise.resolve(
            Response.json({ error: 'tracker route not found' }, {
              status: 404,
            }),
          )) as typeof fetch,
        true,
        `Remote tracker has no ${verb} door`,
      ],
      [
        'Worker failure',
        config,
        (() =>
          Promise.resolve(
            Response.json({ error: 'bug not found' }, { status: 500 }),
          )) as typeof fetch,
        true,
      ],
    ] as const
  ) {
    let failed = await marking(settings, transport, true, held)
    test(`box bug ${verb} refuses ${reason} without a local mark`, async () => {
      await throws(
        () => failed.call(`bug_${verb}`, { bug: ids[0] }),
        said,
      )
      ok(!(await failed.box.get([ids[0]], [name]))[0][name])
    })
  }
}
// A reopening takes a resolution back in each store the bug is marked in.
for (let source of ['box', 'yaks.app']) {
  let shared = await marking(undefined, undefined, source == 'box')
  let args = { bug: ids[0], ...source == 'yaks.app' ? { source } : {} }
  await shared.call('bug_resolve', args)
  await shared.call('bug_reopen', args)
  test(`${source} bug reopen leaves its bug open again`, async () => {
    let stores = source == 'box' ? [shared.box, shared.worker] : [shared.worker]
    for (let store of stores) {
      equal((await store.read('.bug.status=open')).length, 1)
    }
  })
}

// The box's default yak names yaks.app its source: its bugs are the Worker's, marked with no source named, and a commit
// it names by a short sha is read as Git reads one.
let head = new TextDecoder().decode(
  (await new Deno.Command('git', { args: ['rev-parse', 'HEAD'] }).output())
    .stdout,
).trim()
let platformHome = await marking(
  { ...config, source: 'yaks.app', code: { cwd: '.' } },
  undefined,
  false,
)
let homeMark = await platformHome.call('bug_resolve', {
  bug: ids[0],
  since: head.slice(0, 7),
  fix: head.slice(0, 9),
})
test('a config naming yaks.app its source marks the Worker by default', async () => {
  equal(valueIn(homeMark), {
    source: 'yaks.app',
    bug: ids[0],
    mark: 'resolved',
  })
  equal(await platformHome.box.read('.bug'), [])
})
test('a resolution names its commits by full sha, read from a short one', async () => {
  let [row] = await platformHome.worker.get([ids[0]], ['resolved'])
  let { since, fix } = row.resolved as Record<string, unknown>
  equal([since, fix], [head, head])
})
test('a short sha that names no one commit is refused, saying why', async () => {
  let said = (fix: string) =>
    platformHome.call('bug_resolve', { bug: ids[0], fix }).then(
      () => 'taken',
      (e) => e.message,
    )
  equal(
    await Promise.all(['feedfacefeedfacefeed', head.slice(0, 5)].map(said)),
    [
      'fix feedfacefeedfacefeed names no commit',
      `fix ${head.slice(0, 5)} is not 7 or more hex characters of a sha`,
    ],
  )
})

// A config naming the box tracker's graph reads and marks its bugs there, by
// the references that graph keeps, and writes nothing to its own.
let tracker = await marking(config, undefined, true, false)
let [held] = await tracker.box.get([ids[0]], ['entity'])
// The box door names the agent behind the run a request names, and the
// tracker's door asks it, so a mark is signed as that agent and run.
let agent = { by: crypto.randomUUID(), via: crypto.randomUUID() }
let boxDoor = api({
  graph: graph({ vocab: boxVocab, storage: ram(boxVocab, options) }),
  authenticate: (r) => r.headers.get('x-via') == agent.via ? agent : null,
})
let served = api({
  graph: tracker.box,
  authenticate: asking(
    'http://box.test',
    ((url, init) => boxDoor(new Request(url, init))) as typeof fetch,
  ),
})
let here = graph({ vocab: boxVocab, storage: ram(boxVocab, options) })
let viaBox = loadTools(
  trackerDoc,
  runs(
    {},
    { box: 'http://box.test' },
    ((url, init) => served(new Request(url, init))) as typeof fetch,
  ),
)
let use = async (name: string, args: Record<string, unknown>) => {
  let tool = viaBox.find((t) => t.name == name)!
  let said = name == 'bug_resolve' ? why : {}
  return valueIn(
    await tool.run({
      entity: { eid: ids[4] },
      call: { args: validateToolInput(tool, { ...said, ...args }) },
      $actor: agent,
    }, here),
  ) as Record<string, unknown>
}
let boxListed = await use('bug_list', {})
let shown = await use('bug_show', { bug: `B-${held.entity.num}` })
let resolved = await use('bug_resolve', { bug: `B-${held.entity.num}` })
let afterResolve = await tracker.box.read('.bug.status=resolved')
let [signedBy] = await tracker.box.get([ids[0]], ['resolved'])
await use('bug_reopen', { bug: 'mark me' })
let afterReopen = await tracker.box.read('.bug.status=open')
test('a config naming the box tracker reads and marks its bugs there', async () => {
  let eids = (rows: unknown) => (rows as Bundle[]).map((b) => b.entity.eid)
  equal(eids(boxListed.rows), [ids[0]])
  equal(eids(shown.rows), [ids[0]])
  equal(resolved, { source: 'box', bug: ids[0], mark: 'resolved' })
  equal(eids(afterResolve), [ids[0]])
  let { by, via } = signedBy.resolved as Record<string, unknown>
  equal({ by, via }, agent)
  equal(eids(afterReopen), [ids[0]])
  equal(await here.read('.entity *'), [])
})
test('a config naming the box tracker refuses what it does not hold', async () => {
  let refused = await use('bug_show', { bug: 'B-999999' }).catch((e) => e)
  equal(refused.message, 'B-999999 names nothing')
})

// A failed run in the platform tracker goes back to its pool through the
// Worker's retry door, the same write effect_retry applies in a box graph.
let rerun = await marking()
let run = ids[2]
await rerun.worker.apply([{
  entity: { eid: run },
  effect: {
    handler: 'bug_settle',
    target: ids[0],
    state: 'failed',
    attempts: 10,
    error: 'The RPC receiver does not implement the method "settle".',
    at: '2026-11-06T00:00:00Z',
  },
}], { trusted: true })
let rerunAnswer = await rerun.call('tracker_retry', { of: 'bug_settle' })
test('tracker_retry puts the platform tracker’s failed runs back to pending', async () => {
  equal(valueIn(rerunAnswer), {
    source: 'yaks.app',
    of: 'bug_settle',
    retried: 1,
  })
  let [row] = await rerun.worker.get([run], ['effect'])
  let { state, attempts, error } = row.effect as Comp
  equal({ state, attempts, error }, {
    state: 'pending',
    attempts: 0,
    error: undefined,
  })
  equal(await rerun.box.read('.effect'), [])
})
test('tracker_retry refuses a name with no failed run, by handler or id', async () => {
  for (let  of of['bug_settle', run, 'error_frames']) {
    await throws(
      () => rerun.call('tracker_retry', { of }),
      'names no failed effect run in the platform tracker',
    )
  }
})
