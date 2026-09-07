// The scheduled path needs the same proof as an ordinary graph door: a
// heartbeat reaches the directory's Durable Object, changes a wake in its
// transaction, and the graph's own effect rule sees that write. The Deno
// stand-in keeps this a database test without a workerd boot.
import { assertEquals } from '@std/assert'
import type { Bound } from '@yaks/graph'
import { PLATFORM_STORE, storeOf } from './door.ts'
import { Store } from './graph.ts'
import { platform, state } from './harness.ts'
import { meta } from './meta.ts'
import type { Plugin, Wake } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { GRAPHQL } from './usage.ts'
import { scheduled } from './wake.ts'

let at = (time: string) => Date.parse(`2026-09-07T${time}:00Z`)
let beat = (time: string) => ({ scheduledTime: at(time) })
let iso = (time: string) => new Date(at(time)).toISOString()
let wake = async (env: ReturnType<typeof platform>['env'], eid: string) =>
  (await meta(env).query(`.eid=${eid}`))[0] as Wake

Deno.test('scheduled writes a wake and its effect rule receives the tick instant', async () => {
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
    }, {
      entity: { eid: 'fixture-duration' },
      wake: { every: '30m' },
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
    let { env } = platform('wake fixture')
    await Promise.all([
      scheduled(beat('09:05'), env),
      scheduled(beat('09:05'), env),
    ])
    assertEquals(seen.length, 1)
    assertEquals((await wake(env, 'fixture-paused')).wake.at, null)
    assertEquals((await wake(env, 'fixture-duration')).wake.at, iso('09:35'))
    assertEquals(seen[0].Now.at, iso('09:05'))
    assertEquals(seen[0].fired, { at: iso('09:05') })
    assertEquals(seen[0].wake, {
      at: iso('09:30'),
      every: '30m',
      note: null,
      target: null,
    })
    await scheduled(beat('09:05'), env)
    await meta(env).apply([{
      entity: { eid: 'fixture-wake' },
      wake: { note: 'same occurrence' },
    }])
    assertEquals(seen.length, 1)
    await scheduled(beat('09:35'), env)
    assertEquals(seen.length, 2)
    assertEquals(seen[1].fired, { at: iso('09:35') })
  } finally {
    PLUGINS.splice(PLUGINS.indexOf(fixture), 1)
  }
})

Deno.test('seeded wake rows survive a directory restart without rewinding or resuming', async () => {
  let { env } = platform('wake restart')
  let ctx = state()
  let store = new Store(ctx, env)
  env.STORE = {
    idFromName: (name) => name,
    get: () => ({ fetch: (req) => store.fetch(req) }),
  }
  await scheduled(beat('04:15'), env)
  assertEquals((await wake(env, 'yak-meter')).wake?.at, iso('05:00'))
  assertEquals((await wake(env, 'yak-trash')).wake?.at, iso('04:20'))
  await meta(env).apply([{
    entity: { eid: 'yak-trash' },
    wake: { at: null, note: 'paused by the owner' },
  }])
  store = new Store(ctx, env)
  await scheduled(beat('04:20'), env)
  assertEquals((await wake(env, 'yak-trash')).wake?.at, null)
  assertEquals((await wake(env, 'yak-trash')).wake?.note, 'paused by the owner')
  assertEquals((await meta(env).query('.wake')).length, 2)
})

Deno.test('the meter wake runs its job at the supplied hour through the scheduled path', async () => {
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
    let { env } = platform('meter wake', { CF_ANALYTICS_TOKEN: 'test' })
    await scheduled(beat('04:55'), env)
    assertEquals(asked.length, 0)
    await scheduled(beat('05:00'), env)
    assertEquals(asked.length, 1)
    assertEquals(asked[0].until, iso('05:00'))
    let row = await wake(env, 'yak-meter')
    assertEquals(row.fired, { at: iso('05:00') })
    assertEquals(row.wake?.at, iso('06:00'))
    await scheduled(beat('05:00'), env)
    assertEquals(asked.length, 1)
  } finally {
    globalThis.fetch = fetch
  }
})

Deno.test('only the kernel can tick the directory, and app stores cannot be ticked', async () => {
  let { env } = platform('wake access')
  let init = { method: 'POST', body: JSON.stringify(beat('04:15')) }
  assertEquals(
    (await storeOf(env.STORE, PLATFORM_STORE)('/tick', init)).status,
    404,
  )
  assertEquals(
    (await storeOf(env.STORE, 'ada/app')('/tick', init, {
      'x-yak-kernel': '1',
    })).status,
    404,
  )
})

Deno.test('a refused scheduled write stays due and its reason reaches the exception log', async () => {
  let { env, object } = platform('wake refusal')
  await scheduled(beat('04:55'), env)
  object(PLATFORM_STORE).door.graph.use({
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
  await scheduled(beat('05:00'), env)
  assertEquals((await wake(env, 'yak-meter')).wake.at, iso('05:00'))
  let rows = await meta(env).query('.exception')
  assertEquals(rows.length, 1)
  let error = rows[0].exception as { request: string; message: string }
  assertEquals(error.request, 'wake yak-meter')
  assertEquals(error.message, 'meter write refused')
})
