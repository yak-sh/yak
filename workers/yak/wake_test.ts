// The clock, as every store now keeps it (D-37562): a wake row is owed at an
// instant, a write to one arms the object's own alarm, and the alarm fires
// what is due and comes back for the next. There is no heartbeat to drive, so
// a test names the instant it wants the tick read at — which is what the
// runtime's `alarm()` does with the present one.
import { assert, assertEquals } from '@std/assert'
import type { Bound, Bundle } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { Store } from './graph.ts'
import { platform, state } from './harness.ts'
import { meta } from './meta.ts'
import type { Plugin, Wake } from './plugin.ts'
import { wakesOf } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { GRAPHQL } from './usage.ts'
import { GIT_STORE, PLATFORM_STORE, storeOf } from './door.ts'
import { KERNEL, metaOf } from './meta.ts'
import type { Env } from './env.ts'
import { reporting } from './wake.ts'

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

Deno.test('a job is marked begun on its row while it runs, and cleared after', async () => {
  let marks: unknown[] = []
  let META = {
    apply: (b: Bundle[], headers?: Record<string, string>) => {
      assertEquals(headers, KERNEL)
      marks.push(b[0].sweep)
      return Promise.resolve(b)
    },
  }
  let row = { entity: { eid: 'yak-trash' }, sweep: { kind: 'trash' } }
  await reporting({ META } as unknown as Env, row, () => {
    assertEquals(marks.length, 1)
    return Promise.resolve()
  })
  assert((marks[0] as { began: string }).began)
  assertEquals(marks[1], { began: null })
})

// A deploy resets the object under whatever job it is running: the job's own
// catch never runs, so the incarnation after it is what can tell.
Deno.test('a job its object died under is reported and fired by the next one', async () => {
  let p = platform('wake resumed')
  await directory(p)
  let began = new Date(Date.now() - 60_000).toISOString()
  await meta(p.env).apply([{
    entity: { eid: 'yak-trash' },
    sweep: { began },
  }], KERNEL)
  let store = new Store(p.states.get(PLATFORM_STORE)!, p.env)
  p.env.STORE = {
    idFromName: (n) => n,
    get: () => ({ fetch: (req: Request) => store.fetch(req) }),
  } as typeof p.env.STORE
  let row = await wake(p.env, 'yak-trash')
  assertEquals((row.sweep as { began: unknown }).began, null)
  assert(Date.parse(row.wake.at!) <= Date.now(), 'the job is due again')
  let [broke] = await meta(p.env).query('.exception')
  assertEquals(
    broke.exception,
    {
      ...broke.exception as object,
      request: 'wake trash',
      message: `wake trash: the run begun ${began} died unfinished`,
    },
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
  // The directory seeds schedules of its own, the hourly meter among them, and
  // near the top of an hour one falls due inside the minute looked ahead here.
  // Paused, with their alarm gone, they leave the one alarm to the wakes this
  // test writes, whatever the clock says.
  let seeded = await meta(p.env).query('.wake') as Wake[]
  await meta(p.env).apply(
    seeded.filter((w) => w.wake.at != null)
      .map((w) => ({ entity: { eid: w.entity.eid }, wake: { at: null } })),
  )
  await storage.deleteAlarm()
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

Deno.test('the git object store keeps a clock too, with nothing owed', async () => {
  let p = platform('git wake')
  await metaOf(storeOf(p.env.STORE, GIT_STORE)).query('.gitobj!')
  assertEquals(await p.object(GIT_STORE).tick(Date.now()), {
    fired: [],
    refused: [],
  })
})

// An app's own vocabulary, with a rule in it: what an app declares to say what
// a firing means. The wake carries no action — the rule is the reaction.
let GARDEN = JSON.stringify({
  $defs: {
    plant: { properties: { name: { type: 'string' } } },
    watered: { properties: { by: { type: 'string' } } },
    waters: {
      rule: true,
      description: 'a plant whose wake has fired is watered',
      match: '.plant, .wake, .fired, +!watered, +watered.by=wake',
    },
  },
})

Deno.test("an app's rule on `fired` advances the row its wake was about", async () => {
  let ctx = state()
  let store = new Store(ctx)
  let head = {
    'x-store': 'ada/garden',
    'x-yak-app': 'a0000000-0000-4000-8000-000000000001',
    'x-yak-person': 'b0000000-0000-4000-8000-000000000002',
    'x-yak-role': 'owner',
  }
  let ask = (path: string, body?: unknown) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: body ? 'POST' : 'GET',
        headers: head,
        body: body == null
          ? undefined
          : typeof body == 'string'
          ? body
          : JSON.stringify(body),
      }),
    )
  assertEquals((await ask('/vocab', GARDEN)).status, 200)
  let now = Date.now() - 1
  assertEquals(
    (await ask('/apply', [{
      entity: { eid: 'fern' },
      plant: { name: 'fern' },
      wake: { at: new Date(now).toISOString(), note: 'water me' },
    }])).status,
    200,
  )
  // The write armed the object, and firing is the server's write: an app's
  // own guard is about a person writing its data, and no person is ticking.
  assertEquals(await ctx.storage.getAlarm(), now)
  await ctx.storage.deleteAlarm()
  await store.alarm()
  let [row] =
    await (await ask(`/query?q=${encodeURIComponent('.watered!&.wake?')}`))
      .json() as {
        watered: { by: string }
        wake: { at: string | null }
      }[]
  assertEquals(row.watered.by, 'wake')
  assertEquals(row.wake.at, null)
})

// An app's own command, called later (T-37605). A `call` is a row in the
// app's store — what was asked, the claim while it runs, the answer beside it
// — so a call wearing a `wake` is work asked for later, and nothing outside
// this object has to be awake for it.
let CHORES = JSON.stringify({
  add_chore: {
    description: 'Write down a chore',
    input: { name: 'text' },
    apply: { entity: { eid: '$chore' }, chore: { name: '$name' } },
  },
})
let CHORE_WORDS = JSON.stringify({
  $defs: { chore: { properties: { name: { type: 'string' } } } },
})

let app = (name = 'ada/chores', ctx = state()) => {
  let store = new Store(ctx)
  let head = {
    'x-store': name,
    'x-yak-app': 'a0000000-0000-4000-8000-000000000001',
    'x-yak-person': 'b0000000-0000-4000-8000-000000000002',
    'x-yak-role': 'owner',
  }
  let ask = (path: string, body?: unknown) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: body == null ? 'GET' : 'POST',
        headers: head,
        body: body == null
          ? undefined
          : typeof body == 'string'
          ? body
          : JSON.stringify(body),
      }),
    )
  let rows = async (line: string) =>
    await (await ask(`/query?q=${encodeURIComponent(line)}`)).json() as Bundle[]
  return { ctx, store, ask, rows }
}

let chores = async () => {
  let a = app()
  assertEquals((await a.ask('/vocab', CHORE_WORDS)).status, 200)
  assertEquals((await a.ask('/tools', CHORES)).status, 200)
  return a
}

Deno.test('a call wearing a wake waits for it, and answers when it fires', async () => {
  let a = await chores()
  // A call nobody scheduled is due when it is written: the other rule.
  await a.ask('/apply', [{
    entity: { eid: 'now' },
    call: { to: toolEid('add_chore'), args: '{"name":"take the bins out"}' },
  }])
  assertEquals((await a.rows('.result.call=now')).length, 1)
  let now = Date.now() - 1
  assertEquals(
    (await a.ask('/apply', [{
      entity: { eid: 'later' },
      call: { to: toolEid('add_chore'), args: '{"name":"water the plants"}' },
      wake: { at: new Date(now).toISOString() },
    }])).status,
    200,
  )
  // Written and sleeping: the ready rule says `!wake` and this one wears one.
  assertEquals((await a.rows('.result.call=later')).length, 0)
  assertEquals((await a.rows('.chore')).length, 1)
  assertEquals(await a.ctx.storage.getAlarm(), now)
  await a.ctx.storage.deleteAlarm()
  await a.store.alarm()
  // The firing is what ran it: the chore the template names is written, and
  // the answer is beside the ask.
  assertEquals(
    (await a.rows('.chore')).map((b) => (b.chore as { name: string }).name)
      .sort(),
    ['take the bins out', 'water the plants'],
  )
  assertEquals((await a.rows('.result.call=later')).length, 1)
  assertEquals(
    (await a.rows('.execution'))[0].execution,
    // Nobody named a runner here, so the claim is anonymous.
    { state: 'done', by: null },
  )
})

Deno.test('a recurring call is one invocation per firing, never a re-run', async () => {
  let a = await chores()
  let first = Date.now() - 1
  await a.ask('/apply', [{
    entity: { eid: 'daily' },
    call: { to: toolEid('add_chore'), args: '{"name":"sweep"}' },
    wake: { at: new Date(first).toISOString(), every: '1d' },
  }])
  await a.ctx.storage.deleteAlarm()
  await a.store.alarm()
  // The schedule keeps asking: it is never answered itself, and the firing
  // wrote a call of its own.
  assertEquals((await a.rows('.result.call=daily')).length, 0)
  assertEquals((await a.rows('.call.source=daily')).length, 1)
  assertEquals((await a.rows('.chore')).length, 1)
  // The next occurrence, a day on, is its own invocation and its own answer.
  let [row] = await a.rows('.eid=daily&.wake?')
  await a.ctx.storage.setAlarm(Date.parse((row.wake as { at: string }).at))
  await a.store.tick(Date.parse((row.wake as { at: string }).at))
  assertEquals((await a.rows('.call.source=daily')).length, 2)
  assertEquals((await a.rows('.chore')).length, 2)
  assertEquals((await a.rows('.result')).length, 2)
})

// The offline simulation, as the guide writes it (docs/wakes.md, T-37613).
// An idle game wants a cadence of a few minutes that keeps advancing while
// nobody has the page open. The whole of it is one row: the world wears the
// ask (`call`) and the cadence (`wake{every}`), so every firing runs the
// app's own command once — and a stretch nobody was there for collapses into
// one firing, which is what catching up means here.
let IDLER = JSON.stringify({
  $defs: {
    world: { properties: { name: { type: 'string' } } },
    tick: { properties: {} },
  },
})
let ADVANCE = JSON.stringify({
  advance: {
    description: 'Advance the world to now',
    input: {},
    apply: { entity: { eid: '$tick' }, tick: {} },
  },
})

Deno.test('an idle world advances offline, a missed stretch in one firing', async () => {
  let a = app('ada/idler')
  assertEquals((await a.ask('/vocab', IDLER)).status, 200)
  assertEquals((await a.ask('/tools', ADVANCE)).status, 200)
  // The command's own row, found by name — what a page writes into `call.to`.
  let [advance] = await a.rows('.tool.name=advance')
  assertEquals(advance.entity.eid, toolEid('advance'))
  assertEquals(
    (await a.ask('/apply', [{
      entity: { eid: 'world' },
      world: { name: 'Eldermoor' },
      call: { to: advance.entity.eid, args: '{}' },
      wake: { at: iso('09:05'), every: '5m' },
    }])).status,
    200,
  )
  let world = async () =>
    (await a.rows('.eid=world&.wake?&.fired?'))[0] as unknown as {
      wake: { at: string; every: string }
      fired: { at: string }
    }
  await a.store.tick(at('09:05'))
  assertEquals((await a.rows('.tick!')).length, 1)
  assertEquals((await a.rows('.call.source=world')).length, 1)
  assertEquals((await world()).fired.at, iso('09:05'))
  assertEquals((await world()).wake.at, iso('09:10'))
  // Half an hour with nothing awake to notice: the seven occurrences owed in
  // between are one firing, so the command runs once more and not seven
  // times, and the cadence carries on from where the catch-up left it.
  await a.store.tick(at('09:40'))
  assertEquals((await a.rows('.tick!')).length, 2)
  let calls = await a.rows('.call.source=world&.created?')
  assertEquals(calls.length, 2)
  // Each invocation says when it was asked for, so the stretch a firing
  // covered is the gap between the last two — what an idle world advances by.
  assert(calls.every((c) => (c.created as { at: string })?.at))
  assertEquals((await world()).fired.at, iso('09:40'))
  assertEquals((await world()).wake.at, iso('09:45'))
  assertEquals((await world()).wake.every, '5m')
})
