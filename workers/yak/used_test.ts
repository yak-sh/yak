import { line } from '@yaks/query'
import { clock, equal, test, until } from '@yaks/testing'
import { ownedBy } from './directory-fixture.ts'
import { derivedEid, graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { useDoc } from '@yaks/platform/directory-vocab'
import {
  recordUse,
  REST,
  scheduleBy,
  scheduleUse,
  useUntil,
  using,
  wake,
} from './used.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { PLATFORM_OBJECT, storeOf } from './door.ts'
import { IDEMPOTENCY, type Namespace } from '@yaks/durable-object/door'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { KERNEL, meta } from './meta.ts'
import { platform } from './testing.ts'
import { Store } from './graph.ts'
import type { Rule } from './mover.ts'
import { within } from './defects.ts'

let PERSON = derivedEid('fixture:person')
let ADMIN = derivedEid('fixture:admin')
let BROWSER = derivedEid('fixture:browser')
let VISITOR = derivedEid('fixture:visitor')

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    doc: { component: true, properties: { title: { type: 'string' } } },
    used: useDoc.$defs!.used,
  },
})

let observed = (() => {
  let allowed = true
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [using(() => allowed)],
  })
  let patch = (title: string) => [{ entity: { eid: 'app' }, doc: { title } }]
  let use = () =>
    (g.read('.entity.eid=app') as { used?: { at: string } }[])[0].used
  let found: unknown[] = []
  let remember = () => found.push(use())
  g.apply(patch('installed'))
  remember()
  g.apply(signed(patch('person changed'), { by: PERSON }), {
    now: '2026-10-01T12:00:00Z',
  })
  remember()
  g.apply(patch('platform touched'), { now: '2026-10-11T21:00:00Z' })
  remember()
  allowed = false
  g.apply(signed(patch('administrative repair'), { by: ADMIN }), {
    now: '2026-10-12T12:00:00Z',
  })
  remember()
  allowed = true
  g.apply(signed(patch('guest changed'), { via: BROWSER }), {
    now: '2026-10-13T12:00:00Z',
  })
  remember()
  return found
})()

test('directory use survives platform writes and excludes administrative work', () => {
  equal(observed, [
    undefined,
    { at: '2026-10-01T12:00:00Z' },
    { at: '2026-10-01T12:00:00Z' },
    { at: '2026-10-01T12:00:00Z' },
    { at: '2026-10-13T12:00:00Z' },
  ])
})

let visits = await (async () => {
  await using p = platform('directory use proof')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
  let space = await ownedBy(dir, VISITOR, 'used-proof')
  await dir.apply({
    entities: [{
      entity: { eid: 'use-proof-app' },
      app: {
        slug: 'probe',
        space: space.eid,
        store: 'used-proof/probe',
        access: 'public',
      },
    }],
  })
  let app = (await dir.app(space, 'probe'))!
  let ask = storeOf(p.env.STORE, 'used-proof/probe', {
    eid: app.eid,
    access: 'public',
  })
  let use = async () =>
    (await meta(p.env).query(line`.entity.eid=${app.eid} ?used`))[0].used
  let found: unknown[] = []
  let installed = await ask('/vocab', {
    method: 'POST',
    body: JSON.stringify({
      $defs: {
        pulse: {
          component: true,
          properties: { n: { type: 'number' } },
        },
      },
    }),
  }, KERNEL)
  await installed.body?.cancel()
  let written = await ask('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: 'pulse' }, pulse: { n: 1 } }]),
  }, KERNEL)
  await written.body?.cancel()
  let exposed = await p.object('used-proof/probe').door
  await exposed.graph.apply([{
    entity: { eid: 'owed-platform-retry' },
    effect: {
      handler: 'builder_install',
      target: 'pulse',
      kind: 'started',
      state: 'pending',
      attempts: 1,
      next: '2000-01-01T00:00:00.000Z',
    },
  }], { trusted: true, deferEffects: () => {} })
  let rule: Rule = {
    mark: 'yak/store/use-proof/1',
    live: 'apps',
    find: line`.pulse.n=1`,
    move: (row) => [{ entity: row.entity, pulse: { n: 2 } }],
  }
  let state = p.states.get('used-proof/probe')!
  let retained: Promise<unknown>[] = []
  let keep = state.waitUntil
  state.waitUntil = (work) => {
    retained.push(work)
    keep(work)
  }
  let current = new Store(state, p.env, [rule])
  let reports: unknown[] = []
  p.env.ERRORS = {
    send: (rows) => {
      reports.push(...rows)
      return Promise.resolve()
    },
  }
  let get = p.env.STORE.get.bind(p.env.STORE)
  let receiptDown = false
  let release: (response: Response) => void = () => {}
  let stalled = new Promise<Response>((resolve) => release = resolve)
  p.env.STORE.get = (id) => {
    if (String(id) == 'used-proof/probe') {
      return { fetch: (r) => current.fetch(r) }
    }
    let stub = get(id)
    return {
      fetch: (r) =>
        receiptDown && String(id) == PLATFORM_OBJECT &&
          new URL(r.url).pathname == '/used'
          ? stalled
          : stub.fetch(r),
    }
  }
  await current.alarm()
  await until(async () => {
    let response = await ask(
      '/query?q=.effect.handler=builder_install',
      {},
      KERNEL,
    )
    return (await response.json() as unknown[]).length == 0
  }, { label: 'owed platform retry completed' })
  let checked = await ask('/query?q=.pulse.n=2', {}, KERNEL)
  let moved = (await checked.json() as unknown[]).length
  let response = await ask('/query?q=.entity', {}, KERNEL)
  await response.body?.cancel()
  found.push(await use())
  receiptDown = true
  let served: number | undefined
  let mutation = within(
    p.env,
    { request: 'user mutation' },
    () =>
      ask('/apply', {
        method: 'POST',
        body: JSON.stringify([{ entity: { eid: 'pulse' }, pulse: { n: 3 } }]),
      }, {
        'x-yak-person': VISITOR,
        'x-yak-role': 'editor',
      }),
  ).then(async (r) => {
    served = r.status
    await r.body?.cancel()
  })
  await until(() => served != null, {
    label: 'mutation served while receipt stalls',
  })
  checked = await ask('/query?q=.pulse.n=3', {}, KERNEL)
  let changed = (await checked.json() as unknown[]).length
  release(new Response('receipt unavailable', { status: 503 }))
  await mutation
  await Promise.all(retained)
  await until(
    () =>
      reports.some((row) =>
        (row as { error?: { tags?: { request?: string } } }).error?.tags
          ?.request ==
          'record app use'
      ),
    { label: 'failed background receipt reported' },
  )
  receiptDown = false
  response = await ask('/query?q=.entity', {}, {
    'x-yak-person': ADMIN,
    'x-yak-role': 'owner',
    'x-yak-administrative': '1',
  })
  await response.body?.cancel()
  found.push(await use())
  response = await ask('/query?q=.entity', {}, {
    'x-yak-person': VISITOR,
    'x-yak-role': 'viewer',
  })
  await response.body?.cancel()
  await until(async () => await use() != null, {
    label: 'visitor receipt recorded',
  })
  found.push(response.status, await use())
  let at = (found.at(-1) as { at: string }).at
  receiptDown = true
  let coalesced = await recordUse(p.env.STORE, app.eid)
  receiptDown = false
  response = await ask('/query?q=.entity', {}, KERNEL)
  await response.body?.cancel()
  found.push(await use())
  return { found, at, moved, served, changed, coalesced }
})()

test('an app visit records use in the directory while platform diagnostics do not', () => {
  equal(visits.found, [undefined, undefined, 200, { at: visits.at }, {
    at: visits.at,
  }])
  equal(visits.moved, 1)
  equal(visits.served, 200)
  equal(visits.changed, 1)
  equal(visits.coalesced, useUntil(Date.parse(visits.at)))
})

let delivery = await (async () => {
  let entered: () => void = () => {}
  let reporting = new Promise<void>((resolve) => entered = resolve)
  let release: () => void = () => {}
  let stalled = new Promise<void>((resolve) => release = resolve)
  let retained: Promise<void>[] = []
  let env = {
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: () =>
          Promise.resolve(new Response('unavailable', { status: 503 })),
      }),
    },
    ERRORS: {
      send: () => {
        entered()
        return stalled
      },
    },
  }
  let served: string | undefined
  let request = within(
    env,
    {},
    async () => {
      scheduleUse(env, 'background-report-proof')
      await reporting
      return 'served'
    },
    undefined,
    {
      retain: (work) => {
        retained.push(work)
      },
    },
  ).then((answer) => {
    served = answer
  })
  await until(() => served != null, {
    label: 'response ignores stalled defect delivery',
  })
  release()
  await request
  await Promise.all(retained)
  return served
})()

test('background receipt defect delivery does not delay the response', () => {
  equal(delivery, 'served')
})

let spoken = await (async () => {
  await using p = platform('retired spelling proof')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
  let space = await ownedBy(dir, VISITOR, 'retired-proof')
  await dir.apply({
    entities: [{
      entity: { eid: 'retired-proof-app' },
      app: {
        slug: 'probe',
        space: space.eid,
        store: 'retired-proof/probe',
        access: 'public',
      },
    }],
  })
  let app = (await dir.app(space, 'probe'))!
  let ask = storeOf(p.env.STORE, 'retired-proof/probe', {
    eid: app.eid,
    access: 'public',
  })
  let status = async (path: string, init: RequestInit = {}) => {
    let r = await ask(path, init, KERNEL)
    await r.body?.cancel()
    return r.status
  }
  let installed = await status('/vocab', {
    method: 'POST',
    body: JSON.stringify({
      $defs: { pulse: { component: true, properties: {} } },
    }),
  })
  let rows = async () =>
    (await meta(p.env).query('.translated'))
      .map((r) => r.translated as { app: string; spelling: string })
      .map(({ app, spelling }) => ({ app, spelling }))
      .sort((a, b) => a.spelling < b.spelling ? -1 : 1)
  let asked = [
    await status('/query?q=.pulse'),
    await status(`/query?q=${encodeURIComponent('.pulse!&.doc?')}`),
    await status(`/query?q=${encodeURIComponent('.pulse!')}`),
  ]
  await until(async () => (await rows()).length == 2, {
    label: 'retired spellings recorded',
  })
  let door = storeOf(p.env.STORE, PLATFORM_STORE)
  let refused = await Promise.all(['.pulse', '.a! .b?'].map(async (s) => {
    let r = await door('/translated', {
      method: 'POST',
      body: JSON.stringify({ eid: app.eid, spelling: s }),
    }, KERNEL)
    await r.body?.cancel()
    return r.status
  }))
  return { app: app.eid, installed, asked, rows: await rows(), refused }
})()

test('a person who calls or visits is active too; an administrator is not', async () => {
  let eids: string[] = []
  let env = {
    STORE: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (r: Request) => {
          eids.push((await r.json()).eid)
          return Response.json({ at: '2999-01-01T00:00:00Z' })
        },
      }),
    },
  }
  let work: Promise<void>[] = []
  let retain = (w: Promise<void>) => work.push(w)
  scheduleBy(env, { person: 'p1' }, 'a1', retain)
  scheduleBy(env, { person: 'root', administrative: true }, 'a2', retain)
  await Promise.all(work)
  equal(eids.sort(), ['a1', 'p1'])
})

test('a query in a retired spelling records its app and spelling once', () => {
  equal(spoken.installed, 200)
  equal(spoken.asked, [200, 200, 200])
  equal(spoken.rows, [
    { app: spoken.app, spelling: '.doc?' },
    { app: spoken.app, spelling: '.pulse!' },
  ])
  equal(spoken.refused, [400, 400])
})

// A restart for a newer deploy can cut off the answer while it is being read:
// the receipt is sent again, one write, and nothing is reported.
test('a receipt whose answer a deploy cuts off is sent again and reported nowhere', async () => {
  let reports: unknown[] = [], sends: Request[] = []
  let cut = () =>
    new Response(
      new ReadableStream({
        pull: (c) =>
          c.error(
            Error('Durable Object reset because a newer deploy reached it: b'),
          ),
      }),
    )
  let ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (request: Request) => {
        sends.push(request)
        return Promise.resolve(
          sends.length == 1 ? cut() : Response.json({ at: 'the hour' }),
        )
      },
    }),
  } as unknown as Namespace
  let env = {
    ERRORS: {
      send: (rows: unknown) => Promise.resolve(void reports.push(rows)),
    },
  } as unknown as Parameters<typeof within>[0]
  equal(
    await within(env, {}, () => recordUse(ns, 'cut-off-app')),
    'the hour',
  )
  equal(sends.length, 2)
  equal(
    sends[0].headers.get(IDEMPOTENCY),
    sends[1].headers.get(IDEMPOTENCY),
  )
  equal(reports, [])
})

test('a receipt an overloaded store refuses is reported once and held back a minute', async () => {
  let sends = 0, reports: unknown[] = []
  let time = clock()
  let ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => {
        sends++
        return sends == 1
          ? Promise.reject(Object.assign(
            Error(
              'Durable Object is overloaded. Requests queued for too long.',
            ),
            { overloaded: true },
          ))
          : Promise.resolve(Response.json({ at: '2099-01-01T00:00:00.000Z' }))
      },
    }),
  } as unknown as Namespace
  let env = {
    ERRORS: {
      send: (rows: unknown) => Promise.resolve(void reports.push(rows)),
    },
  } as unknown as Parameters<typeof within>[0]
  let use = () => within(env, {}, () => recordUse(ns, 'busy-app', time))
  let answers = [await use(), await use()]
  await time.advance(REST)
  answers.push(await use(), await use())
  equal({ answers, sends, reports: reports.length }, {
    answers: [
      null,
      null,
      '2099-01-01T00:00:00.000Z',
      '2099-01-01T00:00:00.000Z',
    ],
    sends: 2,
    reports: 1,
  })
})

test('a write to an app stamps when its store changed, and an install does not', async () => {
  await using p = platform('changed-proof')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) })
  let space = await ownedBy(dir, VISITOR, 'changed-proof')
  await dir.apply({
    entities: [{
      entity: { eid: 'changed-proof-app' },
      app: {
        slug: 'probe',
        space: space.eid,
        store: 'changed-proof/probe',
        access: 'public',
      },
    }],
  })
  let app = (await dir.app(space, 'probe'))!
  let ask = storeOf(p.env.STORE, 'changed-proof/probe', {
    eid: app.eid,
    access: 'public',
  })
  let row = async () =>
    (await meta(p.env).query(line`.entity.eid=${app.eid} ?changed ?used`))[
      0
    ] as {
      changed?: { at: string }
    }
  let installed = await ask('/vocab', {
    method: 'POST',
    body: JSON.stringify({
      $defs: {
        pulse: { component: true, properties: { n: { type: 'number' } } },
      },
    }),
  }, KERNEL)
  await installed.body?.cancel()
  equal((await row()).changed, undefined)
  let wrote = await ask('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: 'pulse' }, pulse: { n: 1 } }]),
  }, KERNEL)
  await wrote.body?.cancel()
  await until(async () => (await row()).changed != null, {
    label: 'write receipt recorded',
  })
  let at = (await row()).changed!.at
  // Before the hour's end, it is the moment of the write, not the hour's end.
  equal(Date.parse(at) <= Date.now(), true)
  // A second report within the hour keeps the first.
  let again = await storeOf(p.env.STORE, PLATFORM_STORE)('/used', {
    method: 'POST',
    body: JSON.stringify({ eid: app.eid, word: 'changed' }),
  }, KERNEL)
  equal(again.status, 200)
  await again.body?.cancel()
  equal((await row()).changed!.at, at)
})

test('a store woken a moment ago is not woken again for every view', async () => {
  let woke: string[] = []
  let time = clock()
  let env = {
    CLOCK: time,
    STORE: {
      idFromName: (name: string) => name,
      get: (name: string) => ({
        fetch: () => (woke.push(name), Promise.resolve(new Response(null))),
      }),
    },
  } as never
  let held: Promise<void>[] = []
  let view = (store: string) => wake(env, store, (w) => void held.push(w))
  view('a'), view('a'), view('b')
  await time.advance(9_999)
  view('a')
  await time.advance(1)
  view('a')
  await Promise.all(held)
  equal(woke.sort(), ['a', 'a', 'b'])
})

// Isolates of one colo: each its own namespace (its own holds), one shared
// cache. The store answers the hour's end, or refuses as overloaded.
let colo = (refuse = () => false) => {
  let sends = 0, reports: unknown[] = [], shelf = new Map<string, string>()
  let time = clock()
  let isolate = () =>
    ({
      idFromName: (name: string) => name,
      get: () => ({
        fetch: () => {
          sends++
          return refuse()
            ? Promise.reject(Object.assign(
              Error('Durable Object is overloaded. Requests queued too long.'),
              { overloaded: true },
            ))
            : Promise.resolve(
              Response.json({ at: useUntil(time.now()) }),
            )
        },
      }),
    }) as unknown as Namespace
  let cache = () =>
    Promise.resolve({
      match: (req: Request) =>
        Promise.resolve(
          shelf.has(req.url) ? new Response(shelf.get(req.url)) : undefined,
        ),
      put: async (req: Request, res: Response) =>
        void shelf.set(req.url, await res.text()),
    })
  let env = {
    ERRORS: {
      send: (rows: unknown) => Promise.resolve(void reports.push(rows)),
    },
  } as unknown as Parameters<typeof within>[0]
  let use = (ns: Namespace, shelved = cache) =>
    within(env, {}, () => recordUse(ns, 'crawled-app', time, shelved))
  return { isolate, use, time, sent: () => sends, reports }
}

test('isolates of one colo send an app one use receipt an hour between them', async () => {
  let c = colo()
  let answers = []
  for (let i = 0; i < 5; i++) answers.push(await c.use(c.isolate()))
  let first = c.sent()
  await c.time.advance(3_600_000)
  await c.use(c.isolate())
  equal({ first, after: c.sent(), same: new Set(answers).size }, {
    first: 1,
    after: 2,
    same: 1,
  })
})

test('a colo holds back a receipt an overloaded store refused for a minute', async () => {
  let down = true
  let c = colo(() => down)
  for (let i = 0; i < 5; i++) await c.use(c.isolate())
  let refused = c.sent()
  down = false
  await c.time.advance(REST)
  let at = await c.use(c.isolate())
  equal({ refused, sent: c.sent(), took: at != null }, {
    refused: 1,
    sent: 2,
    took: true,
  })
})

test('a colo cache that fails is asked around and reported', async () => {
  let c = colo()
  let broken = () => Promise.reject(Error('cache unavailable'))
  let at = await c.use(c.isolate(), broken)
  equal({ took: at != null, sent: c.sent(), reported: c.reports.length > 0 }, {
    took: true,
    sent: 1,
    reported: true,
  })
})
