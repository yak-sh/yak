// An object past the rows it may read or write stops until its window ends
// (@yaks/durable-object `bounded`): a read is told how long to wait, a
// person's write is kept and lands once the window ends, and nothing it meets
// meanwhile is marked failed. Each store spends its rows through the ceiling
// its driver counts against, on a clock the case moves.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { bounded } from '@yaks/durable-object/ceiling'
import { by, tally } from '@yaks/sql'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { doorOf } from './door.ts'
import { IDEMPOTENCY } from '@yaks/durable-object/door'
import { Store } from './graph.ts'
import { Builder } from './build.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { WAKE } from './door.ts'
import { db, state, titling } from './testing.ts'
import { Pending } from './writes.ts'
import { BINARY, binary } from '@yaks/vocab/wire'

let NAME = 'ada/notes'
let MINUTE = 60_000

let titled = (eid: string, title: string) => ({
  entity: { eid },
  doc: { title },
})

// An object's storage refusing past the platform's windows on the case's
// clock, and a way to spend its rows: past what it may read in a minute
// (50 million, ceiling.ts `WINDOWS`), or write (100,000).
let held = () => {
  let at = { t: 0 }
  let ctx = state()
  let ceiling = bounded(ctx.storage, { now: () => at.t, refuse: true })
  let spend = (kind: 'read' | 'written') =>
    ceiling.count({
      shape: () => 'spent',
      rowsRead: kind == 'read' ? 60e6 : 0,
      rowsWritten: kind == 'written' ? 200_000 : 0,
      returned: 0,
    })
  return { at, ctx, ceiling, spend }
}

// A store with one note in it, speaking `words` beside the platform's, and
// the last answer its door gave.
let object = async (words?: unknown) => {
  let h = held()
  let store = new Store(h.ctx, {}, undefined, { now: () => h.at.t })
  if (words) {
    await store.fetch(
      new Request('http://store/vocab', {
        method: 'POST',
        headers: { ...KERNEL, 'x-store': NAME },
        body: JSON.stringify(words),
      }),
    )
  }
  let last: Response | undefined
  let door = metaOf(
    doorOf(async (r) => (last = await store.fetch(r)).clone(), NAME),
  )
  let apply = (b: unknown[]) => door.apply(b as never, KERNEL)
  let title = async (eid: string) =>
    ((await door.query(`.entity.eid=${eid}`))[0]?.doc as { title?: string })
      ?.title
  let writes = (state: string) =>
    h.ceiling.free(() => tally(db(h.ctx), 'yak_writes', by({ state })))
  // The window passed by the write titled `word`, as it applies.
  let tipping = (word: string) => {
    let sql = h.ctx.storage.sql
    let exec = sql.exec
    sql.exec = (query, ...bindings) => {
      let cursor = exec.call(sql, query, ...bindings)
      if (!titling(query, bindings, word)) return cursor
      let rows = cursor.toArray()
      return Object.assign(rows, {
        toArray: () => rows,
        rowsRead: 0,
        rowsWritten: 200_000,
      })
    }
    return () => void (sql.exec = exec)
  }
  await apply([titled('n0', 'first')])
  return {
    ...h,
    store,
    apply,
    title,
    writes,
    tipping,
    // The runtime spends an alarm as it rings.
    alarm: async () => {
      await h.ctx.storage.deleteAlarm()
      await store.alarm()
    },
    armed: () => h.ctx.storage.getAlarm(),
    last: () => last!,
  }
}

let stoppedRead = await object()
test('a stopped store answers a read with how long to wait, and serves once the window ends', async () => {
  let o = stoppedRead
  o.spend('read')
  o.at.t = 1_000
  let no = await assertRejects(() => o.title('n0')) as Error
  assertEquals(no.name, 'Stopped')
  assertEquals(o.last().status, 429)
  assertEquals(o.last().headers.get('retry-after'), '59')
  o.at.t = MINUTE
  assertEquals(await o.title('n0'), 'first')
})

let watched = await object()
test('a stopped store refuses a watch with how long to wait', async () => {
  let o = watched
  let sent: { id?: string; refused?: { error: string; retry: unknown } }[] = []
  let ws = {
    readyState: 1,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: () => {},
    deserializeAttachment: () => null,
  }
  o.ctx.live.push(ws as never)
  o.spend('read')
  await o.store.webSocketMessage(
    ws as never,
    JSON.stringify({ subscribe: '.doc', id: 'd' }),
  )
  assertEquals(sent.at(-1)?.refused?.error, 'Stopped')
  assertEquals(sent.at(-1)?.refused?.retry, { after: MINUTE, defer: true })
})

let stoppedWrite = await object()
test('a write to a stopped store is kept, and lands when its alarm rings after the window', async () => {
  let o = stoppedWrite
  o.spend('written')
  o.at.t = 1_000
  await assertRejects(() => o.apply([titled('n1', 'second')]), Pending)
  assertEquals(o.last().status, 202)
  assertEquals(o.last().headers.get('retry-after'), '59')
  assertEquals([o.writes('pending'), await o.armed()], [1, MINUTE])
  // Past its written rows only, it still reads.
  assertEquals(await o.title('n1'), undefined)
  // An alarm that rings early does nothing but come back.
  await o.alarm()
  assertEquals([o.writes('pending'), await o.armed()], [1, MINUTE])
  o.at.t = MINUTE
  await o.alarm()
  assertEquals(await o.title('n1'), 'second')
  assertEquals(o.writes('pending') + o.writes('failed'), 0)
})

let stoppedReading = await object()
test('a write to a store past what it may read is kept too', async () => {
  let o = stoppedReading
  o.spend('read')
  await assertRejects(() => o.apply([titled('n1', 'kept')]), Pending)
  assertEquals(o.writes('pending'), 1)
  o.at.t = MINUTE
  await o.alarm()
  assertEquals(await o.title('n1'), 'kept')
})

// A photo's bytes, sent as the binary door takes them. Decoding them needs
// the store's words, and the door they come through tells the store something
// new (its access mode), which a stopped store can't write down.
let PHOTOS = {
  $defs: {
    photo: {
      component: true,
      type: 'object',
      properties: { bytes: { type: 'string', contentEncoding: 'base64' } },
    },
  },
}
let photo = (
  o: Awaited<ReturnType<typeof object>>,
  body: BodyInit,
  headers: Record<string, string> = {},
) =>
  o.store.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers: {
        ...KERNEL,
        ...headers,
        'x-store': NAME,
        'x-yak-access': 'public',
        'content-type': BINARY,
      },
      body,
    }),
  )
let snapped = binary([{
  entity: { eid: 'p1' },
  photo: { bytes: Uint8Array.of(0, 255, 128) },
}])
for (let kind of ['read', 'written'] as const) {
  let o = await object(PHOTOS)
  test(`a binary write to a store past what it may ${kind == 'read' ? 'read' : 'write'} is kept, and lands with its bytes when the window ends`, async () => {
    o.spend(kind)
    let answer = await photo(o, snapped)
    assertEquals([answer.status, o.writes('pending')], [202, 1])
    o.at.t = MINUTE
    await o.alarm()
    let [found] = await (await o.store.fetch(
      new Request('http://store/query?q=.entity.eid=p1', {
        headers: { ...KERNEL, 'x-store': NAME },
      }),
    )).json()
    assertEquals(found?.photo, {
      bytes: { $bytes: 'AP+A', encoding: 'base64' },
    })
  })
}

let outboxed = await object(PHOTOS)
test("a stopped store keeps an outbox's binary write, lands it when the window ends, and answers its resend from the receipt", async () => {
  let o = outboxed, key = { [IDEMPOTENCY]: 'outbox:photo' }
  o.spend('written')
  let answer = await photo(o, snapped, key)
  assertEquals([answer.status, o.writes('pending')], [202, 1])
  o.at.t = MINUTE
  await o.alarm()
  assertEquals(o.writes('applied'), 1)
  let again = await photo(o, snapped, key)
  assertEquals(again.status, 200)
  assertEquals((await again.json())[0]?.photo, {
    bytes: { $bytes: 'AP+A', encoding: 'base64' },
  })
})

let torn = await object(PHOTOS)
test('a stopped store refuses a binary write it cannot read, keeping nothing', async () => {
  torn.spend('written')
  let answer = await photo(torn, snapped.slice(0, 2))
  assertEquals([answer.status, torn.writes('pending')], [400, 0])
})

let tipped = await object()
test('a write that passes the window as it applies is kept, not lost', async () => {
  let o = tipped
  let restore = o.tipping('tipping')
  try {
    await assertRejects(() => o.apply([titled('n1', 'tipping')]), Pending)
  } finally {
    restore()
  }
  assertEquals(o.writes('pending'), 1)
  assertEquals(await o.armed(), MINUTE)
  o.at.t = MINUTE
  await o.alarm()
  assertEquals(await o.title('n1'), 'tipping')
})

let replayed = await object()
test('a replay the window stops waits as it was, and the writes behind it with it', async () => {
  let o = replayed
  o.spend('written')
  for (let [eid, word] of [['n1', 'tipping'], ['n2', 'behind']]) {
    await assertRejects(() => o.apply([titled(eid, word)]), Pending)
  }
  o.at.t = MINUTE
  let restore = o.tipping('tipping')
  try {
    await o.alarm()
  } finally {
    restore()
  }
  assertEquals([o.writes('pending'), o.writes('failed')], [2, 0])
  assertEquals(await o.armed(), 2 * MINUTE)
  o.at.t = 2 * MINUTE
  await o.alarm()
  assertEquals([await o.title('n1'), await o.title('n2')], [
    'tipping',
    'behind',
  ])
})

test('the directory is told of its rows and never stopped', async () => {
  let h = held()
  let store = new Store(h.ctx, {}, undefined, { now: () => h.at.t })
  let ask = async () =>
    (await store.fetch(
      new Request('http://store/query?q=.entity', {
        headers: { ...KERNEL, 'x-store': PLATFORM_STORE },
      }),
    )).status
  assertEquals(await ask(), 200)
  h.spend('read')
  assertEquals(await ask(), 200)
})

test('a stopped Builder answers its doors with how long to wait, and wakes once the window ends', async () => {
  let h = held()
  let builder = new Builder(h.ctx, {} as Env)
  let wake = () =>
    builder.fetch(new Request(`http://builder${WAKE}`, { headers: KERNEL }))
  h.spend('read')
  h.at.t = 1_000
  let no = await wake()
  assertEquals([no.status, no.headers.get('retry-after')], [429, '59'])
  assertEquals((await no.json()).error, 'Stopped')
  h.at.t = MINUTE
  assertEquals((await wake()).status, 204)
})

test("a stopped Builder's alarm comes back when the window ends", async () => {
  let h = held()
  let builder = new Builder(h.ctx, {} as Env)
  h.spend('written')
  let before = Date.now()
  await builder.alarm()
  let at = await h.ctx.storage.getAlarm() as number
  assert(at >= before + MINUTE && at <= Date.now() + MINUTE)
})
