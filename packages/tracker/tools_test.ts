// Bug reads cross the signed Worker door while remote entities stay outside
// the box graph. The declared tools exercise the same arguments as CLI/MCP.
import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ids as addresses } from '@yaks/id/graph'
import { idDoc } from '@yaks/id/vocab'
import { loadVocab } from '@yaks/vocab'
import { validateToolInput } from '@yaks/vocab/tools'
import { ram } from '@yaks/ram'
import { runner, toolEid } from '@yaks/tools'
import { valueIn } from '@yaks/tools/value'
import { door } from '../../workers/tracker/door.ts'
import { options, platform, store, vocab } from '../../workers/tracker/core.ts'
import { trackerDoc } from './vocab.ts'
import { runs } from './tools.ts'
import { routes } from './routes.ts'
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
    ...i == 2 ? { resolved: {} } : {},
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
let go = ((url, init) => upstream(new Request(url, init))) as typeof fetch
let read = runner(box, {
  tools: loadTools(trackerDoc, runs({}, config, go)),
}).read
let ask = (name: string, args: Record<string, unknown> = {}) =>
  read({
    entity: { eid: ids[4] },
    call: { to: toolEid(name), args },
  })
let rows = (answer: Bundle[]) => valueIn(answer)?.rows as Bundle[]

// Prepare the signed read once, then check both the remote result and the box.
let listed = await ask('bug_list', { source: 'yaks.app', limit: 1 })
test('platform bug list filters and sorts before its limit without importing rows', async () => {
  let answer = listed
  equal(valueIn(answer)?.source, 'yaks.app')
  equal(rows(answer).map((b) => b.entity.eid), [ids[1]])
  ok(
    String(answer[0].content && (answer[0].content as { body: string }).body)
      .includes('yaks.app'),
  )
  equal(await box.read('.entity *'), before)
})
test('platform bug list applies the caller query and order at the remote store', async () => {
  let answer = await ask('bug_list', {
    source: 'yaks.app',
    query: '.bug .order=bug.hits',
    limit: 2,
  })
  equal(valueIn(answer)?.source, 'yaks.app', JSON.stringify(answer))
  equal(rows(answer).map((b) => b.entity.eid), [ids[0], ids[1]])
})
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
    equal(valueIn(answer), { source: 'box', rows: [boxBug] })
    equal(
      JSON.parse((answer[0].content as { body: string }).body),
      valueIn(answer),
    )
  }
  equal(await box.read('.entity *'), before)
})
for (let source of ['box', 'yaks.app']) {
  let empty = await ask('bug_list', { source, query: '.bug.hits=999' })
  test(`${source} bug list answers an empty result as text and data`, () => {
    equal(valueIn(empty), { source, rows: [] })
    equal(JSON.parse((empty[0].content as { body: string }).body), {
      source,
      rows: [],
    })
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
test('missing platform bugs and unavailable configuration are explicit failures', async () => {
  ok(
    (await ask('bug_show', { source: 'yaks.app', bug: ids[4] })).some((b) =>
      b.refusal
    ),
  )
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
let marking = async (
  config = { remote: { url: 'https://tracker.test', secret: 'test-only' } },
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
    call: async (name: string, args: Record<string, unknown>) => {
      let tool = tools.find((t) => t.name == name)!
      let patches = await tool.run({
        entity: { eid: ids[4] },
        call: { args: validateToolInput(tool, args) },
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
    ok((await shared.worker.get([ids[0]], [name]))[0][name])
    equal((await shared.worker.read('.bug.status=open')).length, 0)
  })
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
  test(`platform bug ${verb} refuses a bug the Worker does not hold`, async () => {
    await throws(
      () => missing.call(`bug_${verb}`, { bug: ids[0], source: 'yaks.app' }),
      'Remote tracker bug not found',
    )
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
        (() => Promise.reject(Error('offline'))) as typeof fetch,
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
