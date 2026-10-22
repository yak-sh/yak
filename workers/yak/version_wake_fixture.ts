// A Store's first wake under a new Worker version, beside its ordinary wake
// under the same one, measured with workerd's billed SQL cursor counters: the
// directory (whose release is the Worker's) and an app's store (whose release
// is its own). Every commit on main is a new version, and whoever's request
// lands first after it pays for whatever that wake does that an ordinary one
// does not. What a deploy owes goes to the alarm, measured apart.
import { type State, Store } from './graph.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import { IDEMPOTENCY, PLATFORM_STORE, storeOf } from './door.ts'
import type { Env } from './env.ts'
import { type Cost, meter, settle } from './release_cost_fixture.ts'
import { driver } from '@yaks/durable-object'
import { by, col, op, scan, val } from '@yaks/sql'

let context = (storage: State['storage']) => ({
  storage,
  getWebSockets: () => [],
  acceptWebSocket: () => {},
})

let on = (id: string) => ({ CF_VERSION_METADATA: { id } })

// What a deploy that changed a store's words leaves it holding: its schema
// prints and stamps are of words it no longer speaks, and its statistics are
// those of the rows it holds.
let reworded = (storage: State['storage']) => {
  let sql = driver(storage)
  sql.query({
    t: 'delete',
    from: 'server_meta',
    where: op('like', col('k'), val('schema:%')),
  })
  let [receipt] = scan(sql, 'server_meta', by({ k: 'schema' }), ['v'])
  let [, statistics] = String(receipt.v).split('\n')
  for (let [table, v] of [['server_meta', statistics], ['yak_kv']]) {
    sql.query({
      t: 'update',
      table,
      set: { v: val(['previous words', ...v ? [v] : []].join('\n')) },
      where: by({ k: 'schema' }),
    })
  }
}

/** What one wake of `store` under each step costs: the request that woke it,
 * and the alarms that followed. */
let wakes = (storage: State['storage']) => {
  let m = meter(storage)
  let alarms: Record<string, number> = {}
  return {
    wake: async (
      step: string,
      store: () => Store,
      request: () => Promise<unknown>,
    ) => {
      m.step(step)
      await request()
      m.step(`${step} alarm`)
      alarms[step] = await settle(storage, store)
      m.step(null)
    },
    report: () => ({
      steps: Object.fromEntries(
        Object.entries(m.steps).map(([name, s]) => [name, s.total]),
      ) as Record<string, Cost>,
      alarms,
      top: m.top(25),
    }),
    stop: () => m.stop(),
  }
}

/** The directory, `history` spaces deep, as it stands between deploys, then
 * woken under the next version, again under the same one, under one after a
 * table that was empty gained a row, and under one that changed its words. */
export let directoryWake = async (
  storage: State['storage'],
  bindings: Pick<Env, 'STORE' | 'BLOBS'>,
  history: number,
) => {
  let ctx = context(storage)
  let store: Store
  let env = (id: string) =>
    ({
      ...bindings,
      ...on(id),
      STORE: {
        idFromName: (name: string) => name,
        get: (name: unknown) =>
          name == PLATFORM_STORE
            ? { fetch: (req: Request) => store.fetch(req) }
            : bindings.STORE.get(bindings.STORE.idFromName(String(name))),
      },
      STORE_TRACING: 'off',
    }) as unknown as Env
  store = new Store(ctx, env('a'))
  let meta = metaOf(storeOf(env('a').STORE, PLATFORM_STORE))
  let dir = directory({ fetch: (req) => directoryFetch(req, env('a')) }, true)
  await dir.apply({ entities: [] })
  let person = (await dir.personAt('admin@bot.yak.sh'))!
  for (let start = 0; start < history; start += 100) {
    await meta.apply(
      Array.from({ length: Math.min(100, history - start) }, (_, i) => {
        let space = crypto.randomUUID()
        return [{
          entity: { eid: space },
          space: { slug: `wake-${start + i}`, store: `wake-${start + i}` },
          doc: { title: `Space ${start + i}`, body: 'kept' },
        }, {
          entity: { eid: crypto.randomUUID() },
          member: { space, person, role: 'owner' },
        }]
      }).flat(),
      KERNEL,
    )
  }
  let [space] = await meta.query('.space.slug=wake-0')
  let ask = (id: string) => () => {
    store = new Store(ctx, env(id))
    return meta.query(`.entity.eid=${space.entity.eid}`)
  }
  await settle(storage, () => store)
  // One release in, as the directory stands between deploys: its statistics,
  // descriptions and moved rows are those of the rows it holds.
  await ask('b')()
  await settle(storage, () => store)
  let w = wakes(storage)
  try {
    await w.wake('new version', () => store, ask('c'))
    await w.wake('same version', () => store, ask('c'))
    await meta.apply([{ entity: { eid: space.entity.eid }, archived: {} }], {
      ...KERNEL,
    })
    await w.wake('populated', () => store, ask('d'))
    reworded(storage)
    await w.wake('changed words', () => store, ask('e'))
    return { history, ...w.report() }
  } finally {
    w.stop()
  }
}

let HEADERS = {
  'x-store': 'probe/version-wake',
  'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  'x-yak-role': 'owner',
  'x-yak-access': 'private',
  'x-yak-release': '1',
}

/** An app's store, `history` documents deep and released once, woken under
 * the next version, again under the same one, and under one that changed the
 * platform's words. */
export let appWake = async (storage: State['storage'], history: number) => {
  let ctx = context(storage)
  let store = new Store(ctx, on('a'), [])
  let send = async (path: string, body?: unknown) => {
    let res = await store.fetch(
      new Request(`https://store${path}`, {
        headers: { ...HEADERS, [IDEMPOTENCY]: crypto.randomUUID() },
        ...(body === undefined ? {} : {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      }),
    )
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`)
    return await res.json()
  }
  await send('/vocab', {
    $defs: {
      note: { component: true, properties: { label: { type: 'string' } } },
    },
  })
  for (let start = 0; start < history; start += 100) {
    await send(
      '/apply',
      Array.from({ length: Math.min(100, history - start) }, (_, i) => ({
        entity: { eid: crypto.randomUUID() },
        note: { label: `kept ${start + i}` },
        doc: { title: `Retained document ${start + i}`, body: 'lemon' },
      })),
    )
  }
  await settle(storage, () => store)
  let ask = (id: string) => () => {
    store = new Store(ctx, on(id), [])
    return send('/query?q=' + encodeURIComponent('.note .limit=1'))
  }
  let w = wakes(storage)
  try {
    await w.wake('new version', () => store, ask('b'))
    await w.wake('same version', () => store, ask('b'))
    reworded(storage)
    await w.wake('changed words', () => store, ask('c'))
    return { history, ...w.report() }
  } finally {
    w.stop()
  }
}
