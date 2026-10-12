import { equal, test, until } from '@yaks/testing'
import { derivedEid, graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { useDoc } from './facets/directory-vocab.ts'
import { recordUse, using } from './used.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { PLATFORM_STORE, storeOf } from './door.ts'
import { KERNEL, meta } from './meta.ts'
import { platform } from './testing.ts'
import { Store } from './graph.ts'
import type { Rule } from './mover.ts'

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
  let g = graph({ storage: ram(vocab), vocab, plugins: [using(() => allowed)] })
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
  g.apply([{ entity: { eid: 'app' }, used: { at: '2026-10-13T13:00:00Z' } }], {
    trusted: true,
    stamp: false,
  })
  g.apply(signed(patch('same-hour directory edit'), { by: PERSON }), {
    now: '2026-10-13T12:02:00Z',
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
    { at: '2026-10-13T13:00:00Z' },
  ])
})

let visits = await (async () => {
  using p = platform('directory use proof')
  let dir = directory({ fetch: (r) => directoryFetch(r, p.env) }, true)
  let space = await dir.own(VISITOR, 'used-proof')
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
    (await meta(p.env).query(`.entity.eid=${app.eid} ?used`))[0].used
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
    find: '.pulse.n=1',
    move: (row) => [{ entity: row.entity, pulse: { n: 2 } }],
  }
  let current = new Store(p.states.get('used-proof/probe')!, p.env, [rule])
  let get = p.env.STORE.get.bind(p.env.STORE)
  let receiptDown = false
  p.env.STORE.get = (id) => {
    if (String(id) == 'used-proof/probe') {
      return { fetch: (r) => current.fetch(r) }
    }
    let stub = get(id)
    return {
      fetch: (r) =>
        receiptDown && String(id) == PLATFORM_STORE &&
          new URL(r.url).pathname == '/used'
          ? Promise.resolve(
            new Response('receipt unavailable', { status: 503 }),
          )
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
  let failed = await ask('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: 'pulse' }, pulse: { n: 3 } }]),
  }, {
    'x-yak-person': VISITOR,
    'x-yak-role': 'editor',
  }).then((r) => r.status, (e) => e.status)
  checked = await ask('/query?q=.pulse.n=2', {}, KERNEL)
  let unchanged = (await checked.json() as unknown[]).length
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
  found.push(response.status, await use())
  let at = (found.at(-1) as { at: string }).at
  receiptDown = true
  let coalesced = await recordUse(p.env.STORE, app.eid)
  receiptDown = false
  response = await ask('/query?q=.entity', {}, KERNEL)
  await response.body?.cancel()
  found.push(await use())
  return { found, at, moved, failed, unchanged, coalesced }
})()

test('an app visit records use in the directory while platform diagnostics do not', () => {
  equal(visits.found, [undefined, undefined, 200, { at: visits.at }, {
    at: visits.at,
  }])
  equal(visits.moved, 1)
  equal(visits.failed, 503)
  equal(visits.unchanged, 1)
  equal(visits.coalesced, visits.at)
})
