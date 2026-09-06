/// <reference lib="deno.ns" />
// Putting a store back to a moment (recover.ts, T-34507), at the two seams
// that are ours: the WINDOW a caller is refused by, and the ORDER a restore
// happens in.
//
// The recovery itself is Cloudflare's and is not tested anywhere, because
// there is nowhere to test it: local workerd answers `getCurrentBookmark` and
// refuses `getBookmarkForTime` and `onNextSessionRestoreBookmark` outright —
// "This Durable Object's storage back-end does not implement point-in-time
// recovery" — so the probe kernel (probe.ts) cannot hold this gesture either.
// harness.ts fakes the three calls; what that buys is the bookkeeping, which
// is the half that can be wrong in a way we could have prevented.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { Store } from './graph.ts'
import { state } from './harness.ts'
import { mark, moment, oldest, putBack, recorded, WINDOW } from './recover.ts'

let DAY = 24 * 60 * 60_000
let NOW = Date.parse('2026-09-06T14:20:00Z')

Deno.test('the window is thirty days back from now', () => {
  assertEquals(WINDOW, 30 * DAY)
  assertEquals(
    oldest(NOW).toISOString(),
    new Date(NOW - 30 * DAY).toISOString(),
  )
})

Deno.test('a moment outside the window is refused by name', () => {
  // A time in the window is simply the time.
  assertEquals(
    moment('2026-09-01T00:00:00Z', NOW).toISOString(),
    '2026-09-01T00:00:00.000Z',
  )
  // Each refusal says what is wrong AND what the window is, because a caller
  // told only "no" reaches for a different wrong time next.
  let no = (said: string) => {
    try {
      moment(said, NOW)
    } catch (e) {
      return (e as Error).message
    }
    throw new Error(`${said} was not refused`)
  }
  assertStringIncludes(no('last tuesday'), 'is not a time')
  assertStringIncludes(no('2026-10-01T00:00:00Z'), 'in the future')
  let old = no('2026-07-01T00:00:00Z')
  assertStringIncludes(old, 'outside the 30-day window')
  assertStringIncludes(old, oldest(NOW).toISOString())
})

// The store's door, scripted: what it was asked, in order, and the answers
// recover.ts reads back off it.
let door = (answers: Record<string, unknown>) => {
  let asked: string[] = []
  return {
    asked,
    store: (path: string, init: RequestInit = {}) => {
      asked.push(`${init.method ?? 'GET'} ${path}`)
      let key = path.startsWith('/restore?') ? '/restore?at' : path
      return Promise.resolve(
        Response.json(answers[`${init.method ?? 'GET'} ${key}`] ?? {}),
      )
    },
  }
}

Deno.test('a restore writes down the way back before it moves anything', async () => {
  let d = door({
    'GET /restore?at': { from: 'at-now', to: 'at-then' },
    'POST /restore': { undo: 'undo-at-then' },
  })
  let wrote: string[] = []
  let done = await putBack(
    d.store,
    (r) => {
      wrote.push(`${r.at} ${r.to} ${r.by} ${r.from}`)
      return Promise.resolve()
    },
    new Date('2026-09-01T00:00:00Z'),
    'ada',
    new Date(NOW),
  )
  // The record FIRST. This is the whole point of the function: the bookmark
  // the store stood at is written to a different object before the store is
  // told to go anywhere, so a restore that turns out to be the mistake has a
  // moment to be asked back from.
  assertEquals(d.asked, [
    'GET /restore?at=2026-09-01T00%3A00%3A00.000Z',
    'POST /restore',
  ])
  assertEquals(wrote, [
    '2026-09-06T14:20:00.000Z 2026-09-01T00:00:00.000Z ada at-now',
  ])
  assertEquals(done.undo, 'undo-at-then')
  // And the moment to ask for to undo it is the moment it happened.
  assertEquals(done.at, '2026-09-06T14:20:00.000Z')
})

Deno.test('nothing is written down when the store cannot be read', async () => {
  let store = () =>
    Promise.resolve(
      Response.json({ error: 'Refused', message: 'no recovery here' }, {
        status: 400,
      }),
    )
  let wrote = 0
  await assertRejects(
    () =>
      putBack(store, () => Promise.resolve(void wrote++), new Date(NOW), 'ada'),
    Error,
    'no recovery here',
  )
  assertEquals(wrote, 0)
})

Deno.test('the record is one entity per restore, about the app', () => {
  assertEquals(
    recorded('app-1', {
      at: '2026-09-06T14:20:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      by: 'ada',
      from: 'at-now',
    }),
    [{
      entity: { eid: '$restore' },
      restored: {
        app: 'app-1',
        at: '2026-09-06T14:20:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        by: 'ada',
        from_bookmark: 'at-now',
      },
    }],
  )
})

// ---- the store's own door (graph.ts `#recovery`) ---------------------------

let KERNEL = { 'x-store': 'ada/cookbook', 'x-yak-kernel': '1' }

let at = (store: Store, path: string, init: RequestInit = {}) =>
  store.fetch(
    new Request(`http://store${path}`, {
      ...init,
      headers: { ...KERNEL, ...(init.headers as Record<string, string>) },
    }),
  )

Deno.test('the store answers where it stands, and wakes where it is told', async () => {
  let ctx = state()
  let store = new Store(ctx)
  let stands = await (await at(store, '/restore')).json()
  assertEquals(stands.to, '')
  assertStringIncludes(stands.from, 'at-')
  let asked = await (await at(
    store,
    '/restore?at=2026-09-01T00%3A00%3A00.000Z',
  )).json()
  // A bookmark for the moment, and nothing has moved: reading is a read.
  assertEquals(asked.to, 'at-2026-09-01T00:00:00.000Z')
  assertEquals(ctx.pitr.restore, '')
  assertEquals(ctx.pitr.aborts, 0)
  let done = await at(store, '/restore', {
    method: 'POST',
    body: JSON.stringify({ bookmark: asked.to }),
  })
  assertEquals(await done.json(), { undo: 'undo-at-2026-09-01T00:00:00.000Z' })
  assertEquals(ctx.pitr.restore, 'at-2026-09-01T00:00:00.000Z')
  // The restart is asked for AFTER the answer went out — `abort` fails every
  // in-flight request, this one included — so it lands a turn later.
  assertEquals(ctx.pitr.aborts, 0)
  await new Promise((go) => setTimeout(go, 0))
  assertEquals(ctx.pitr.aborts, 1)
})

Deno.test('a store outside the window refuses, and a client never asks at all', async () => {
  let store = new Store(state())
  let old = new Date(Date.now() - 40 * DAY).toISOString()
  let no = await at(store, `/restore?at=${encodeURIComponent(old)}`)
  assertEquals(no.ok, false)
  assertStringIncludes(await no.text(), '30-day window')
  // The door is the kernel's: a request without the flag is not answered at
  // all, the way the erase is not.
  let outside = await store.fetch(
    new Request('http://store/restore', {
      headers: { 'x-store': 'ada/cookbook' },
    }),
  )
  assertEquals(outside.status, 404)
})

Deno.test('mark reads the bookmark off a store', async () => {
  let store = new Store(state())
  let there = await mark((path, init) => at(store, path, init as RequestInit))
  assertStringIncludes(there.from, 'at-')
})
