// The clock, as every store now keeps it (D-37562): a wake row is owed at an
// instant, a write to one arms the object's own alarm, and the alarm fires
// what is due and comes back for the next. There is no heartbeat to drive, so
// a test names the instant it wants the tick read at — which is what the
// runtime's `alarm()` does with the present one.
import { assert, assertEquals } from '@std/assert'
import type { Bound } from '@yaks/graph'
import { Store } from './graph.ts'
import { platform } from './harness.ts'
import { meta } from './meta.ts'
import type { Plugin, Wake } from './plugin.ts'
import { wakesOf } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { GRAPHQL } from './usage.ts'
import { PLATFORM_STORE, storeOf } from './door.ts'
import { KERNEL, metaOf } from './meta.ts'

let at = (time: string) => Date.parse(`2026-09-07T${time}:00Z`)
let iso = (time: string) => new Date(at(time)).toISOString()
let wake = async (env: ReturnType<typeof platform>['env'], eid: string) =>
  (await meta(env).query(`.eid=${eid}`))[0] as Wake
// The directory's own object, awake: a store learns which one it is from a
// request, so one read is what makes its vocabulary the platform's.
let directory = async (p: ReturnType<typeof platform>) => {
  await meta(p.env).query('.wake')
  return p.object(PLATFORM_STORE)
}
// The bell, as the runtime rings it: the alarm is cleared on delivery, and
// what the object arms afterwards is the next instant it owes.
let ring = async (p: ReturnType<typeof platform>, name = PLATFORM_STORE) => {
  await p.states.get(name)!.storage.deleteAlarm()
  await p.object(name).alarm()
}

Deno.test('a wake fires in the store that holds it and its rule receives the tick instant', async () => {
  let seen: Bound[] = []
  let fixture: Plugin = {
    name: 'wake-fixture',
    wakes: [{
      entity: { eid: 'fixture-wake' },
      wake: { at: iso('09:00'), every: '30m' },
      doc: { title: 'fixture' },
    }, {
      entity: { eid: 'fixture-paused' },
      wake: { at: null, every: '30m' },
    }],
    rules: [{
      phase: 'effect',
      match: '.wake, *fired, .doc, doc.title=fixture, #Now',
      run: (row) => {
        seen.push(row)
        return undefined
      },
    }],
  }
  PLUGINS.push(fixture)
  try {
    let p = platform('wake fixture')
    let store = await directory(p)
    assertEquals(seen.length, 0)
    await store.tick(at('09:05'))
    assertEquals(seen.length, 1)
    assertEquals((await wake(p.env, 'fixture-paused')).wake.at, null)
    assertEquals(seen[0].Now.at, iso('09:05'))
    assertEquals(seen[0].fired, { at: iso('09:05') })
    assertEquals(seen[0].wake, {
      at: iso('09:30'),
      every: '30m',
      note: null,
      target: null,
    })
    // The same instant again takes the occurrence it already took, and a
    // patch that is not a firing is not one.
    await store.tick(at('09:05'))
    await meta(p.env).apply([{
      entity: { eid: 'fixture-wake' },
      wake: { note: 'same occurrence' },
    }])
    assertEquals(seen.length, 1)
    await store.tick(at('09:35'))
    assertEquals(seen.length, 2)
    assertEquals(seen[1].fired, { at: iso('09:35') })
  } finally {
    PLUGINS.splice(PLUGINS.indexOf(fixture), 1)
  }
})

Deno.test('seeded wake rows survive a directory restart without rewinding or resuming', async () => {
  let p = platform('wake restart')
  let store = await directory(p)
  let planted = await meta(p.env).query('.wake')
  assertEquals(planted.length, wakesOf(PLUGINS).length)
  // A recurring seed with no first instant is owed one, and it is ahead.
  let meter = await wake(p.env, 'yak-meter')
  assert(Date.parse(meter.wake.at!) > Date.now())
  await meta(p.env).apply([{
    entity: { eid: 'yak-trash' },
    wake: { at: null, note: 'paused by the owner' },
  }])
  // The object goes and comes back: the rows are the storage's, and the seed
  // pass finds them already there.
  store = new Store(p.states.get(PLATFORM_STORE)!, p.env)
  p.env.STORE = {
    idFromName: (n) => n,
    get: () => ({ fetch: (req: Request) => store.fetch(req) }),
  } as typeof p.env.STORE
  assertEquals((await wake(p.env, 'yak-trash')).wake?.at, null)
  assertEquals(
    (await wake(p.env, 'yak-trash')).wake?.note,
    'paused by the owner',
  )
  assertEquals(
    (await meta(p.env).query('.wake')).length,
    wakesOf(PLUGINS).length,
  )
})

Deno.test('the meter wake runs its job at the supplied hour', async () => {
  let asked: Record<string, unknown>[] = []
  let fetch = globalThis.fetch
  globalThis.fetch = (url, init) => {
    assertEquals(url, GRAPHQL)
    asked.push(JSON.parse(String(init?.body)).variables)
    return Promise.resolve(
      Response.json({ data: { viewer: { accounts: [] } } }),
    )
  }
  try {
    let p = platform('meter wake', { CF_ANALYTICS_TOKEN: 'test' })
    let store = await directory(p)
    // The hour this test means, said outright: the seed plants the next real
    // one, and what is being proved is the firing, not the calendar.
    await meta(p.env).apply([{
      entity: { eid: 'yak-meter' },
      wake: { at: iso('05:00'), every: '@hourly' },
    }])
    await store.tick(at('04:55'))
    assertEquals(asked.length, 0)
    await store.tick(at('05:00'))
    assertEquals(asked.length, 1)
    assertEquals(asked[0].until, iso('05:00'))
    let row = await wake(p.env, 'yak-meter')
    assertEquals(row.fired, { at: iso('05:00') })
    assertEquals(row.wake?.at, iso('06:00'))
    await store.tick(at('05:00'))
    assertEquals(asked.length, 1)
  } finally {
    globalThis.fetch = fetch
  }
})

// A Durable Object shares one I/O context across its in-flight requests, so a
// fetch to its own stub deepens the chain rather than starting one; the meter
// asking the directory once per space ran past the runtime's depth limit
// (T-34844). The alarm removes the last of that hop: the tick is the object's
// own method, so the heartbeat's knock on /tick is gone too.
Deno.test('a directory job reads and writes the directory in-process, never through its own stub', async () => {
  let fetch = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(Response.json({ data: { viewer: { accounts: [] } } }))
  try {
    let p = platform('tick depth', { CF_ANALYTICS_TOKEN: 'test' })
    let store = await directory(p)
    await meta(p.env).apply([
      { entity: { eid: '$s' }, doc: { title: 'ada' }, space: { slug: 'ada' } },
      {
        entity: { eid: '$a' },
        doc: { title: 'app' },
        app: { slug: 'app', space: '$s', store: 'ada/app' },
      },
      { entity: { eid: 'yak-meter' }, wake: { at: iso('05:00') } },
    ])
    let ns = p.env.STORE
    let knocks: string[] = []
    p.env.STORE = {
      idFromName: (n) => ns.idFromName(n),
      get: (id) => {
        let stub = ns.get(id)
        return {
          fetch: (r) => {
            knocks.push(`${id} ${new URL(r.url).pathname}`)
            return stub.fetch(r)
          },
        }
      },
    }
    await store.tick(at('05:00'))
    assertEquals(knocks.filter((k) => k.startsWith(PLATFORM_STORE)), [])
    let [space] = await meta(p.env).query('.space.slug=ada&.meter?')
    assertEquals((space.meter as { month: string }).month, '2026-09')
  } finally {
    globalThis.fetch = fetch
  }
})

Deno.test('a refused wake stays due, says why in the break log, and is tried again', async () => {
  let p = platform('wake refusal')
  let store = await directory(p)
  await meta(p.env).apply([{
    entity: { eid: 'yak-meter' },
    wake: { at: iso('05:00'), every: '@hourly' },
  }])
  store.door.graph.use({
    name: 'refuse-meter',
    hooks: {
      precondition: (rows) => {
        if (rows.some((row) => row.entity.eid == 'yak-meter' && row.fired)) {
          throw new Error('meter write refused')
        }
        return rows
      },
    },
  })
  // The runtime clears the alarm as it delivers it; the tick is what sets the
  // next one, and a refusal is what it is being asked to set here.
  await p.states.get(PLATFORM_STORE)!.storage.deleteAlarm()
  await store.tick(at('05:00'))
  assertEquals((await wake(p.env, 'yak-meter')).wake.at, iso('05:00'))
  let rows = await meta(p.env).query('.exception')
  assertEquals(rows.length, 1)
  let error = rows[0].exception as { request: string; message: string }
  assertEquals(error.request, 'wake yak-meter')
  assertEquals(error.message, 'meter write refused')
  // A refusal is not a dropped occurrence: the object comes back for it.
  assertEquals(
    await p.states.get(PLATFORM_STORE)!.storage.getAlarm(),
    at('05:00') + Store.RETRY,
  )
})

Deno.test('a write arms the object for the wake it just heard, and the alarm fires it', async () => {
  let p = platform('wake alarm')
  await directory(p)
  let storage = p.states.get(PLATFORM_STORE)!.storage
  let soon = Date.now() + 60_000
  await meta(p.env).apply([{
    entity: { eid: '$w' },
    doc: { title: 'a later wake' },
    wake: { at: new Date(soon).toISOString() },
  }])
  assertEquals(await storage.getAlarm(), soon)
  // An earlier wake wins the one alarm; a later one leaves it alone.
  let now = Date.now() - 1
  await meta(p.env).apply([{
    entity: { eid: '$d' },
    doc: { title: 'a wake already owed' },
    wake: { at: new Date(now).toISOString() },
  }])
  assertEquals(await storage.getAlarm(), now)
  await ring(p)
  let [fired] = await meta(p.env).query('.fired&.wake?&.doc.title~=already')
  assert(fired, 'the overdue wake fired')
  assertEquals((fired.wake as { at: string | null }).at, null)
  // And it re-armed for the one still ahead.
  assertEquals(await storage.getAlarm(), soon)
})

Deno.test('an app store keeps its own schedule, with no platform in the middle', async () => {
  let p = platform('app wake')
  let door = metaOf(storeOf(p.env.STORE, 'ada/app'))
  let now = Date.now() - 1
  await door.apply([{
    entity: { eid: 'water' },
    doc: { title: 'water the plants' },
    wake: { at: new Date(now).toISOString(), every: '1d' },
  }], KERNEL)
  assertEquals(await p.states.get('ada/app')!.storage.getAlarm(), now)
  await ring(p, 'ada/app')
  let [row] = await door.query('.fired&.wake?') as unknown as {
    wake: { at: string }
  }[]
  assert(row, 'the app store fired its own wake')
  // A recurrence moves on and the object is armed for the next one.
  assertEquals(
    await p.states.get('ada/app')!.storage.getAlarm(),
    Date.parse(row.wake.at),
  )
})
