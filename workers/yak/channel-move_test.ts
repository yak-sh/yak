import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { channelBackfill, channeled, CHANNELS } from './channel-move.ts'
import { operatorMemory } from './operator-testing.ts'

let session = crypto.randomUUID()
let ids = [1, 2, 3, 4, 5].map(() => crypto.randomUUID())
let said = (i: number, body: string, also: object = {}) =>
  ({
    entity: { eid: ids[i] },
    entry: { session },
    content: { body },
    ...also,
  }) as Bundle

test('words stored with their framing are given the channel it names, once', async () => {
  let { g } = operatorMemory()
  await g.apply([{ entity: { eid: session }, session: {} }], {
    trusted: true,
  })
  await g.apply([
    said(
      0,
      'By phone, spoken aloud (they hear your reply read out: plain speech): I am working',
    ),
    said(1, 'By email: Hello'),
    said(2, 'By phone: How are you?', {
      notice: {},
      operator_call: { call: 'c1' },
    }),
    said(3, 'Tell them By email: tomorrow'),
    said(4, 'By text: done', { output: {} }),
  ], { trusted: true })
  await channeled(g)
  let rows = await g.get(ids)
  assertEquals(
    rows.map((b) => b.channel as Comp | undefined).map((c) =>
      c && [c.name, c.framing]
    ),
    [
      [
        'voice',
        'By phone, spoken aloud (they hear your reply read out: plain speech): ',
      ],
      ['email', 'By email: '],
      ['voice', 'By phone: '],
      undefined,
      undefined,
    ],
  )
})

test("a talking model's old line, framed as the person's words, is made the Operator's own", async () => {
  let { g } = operatorMemory()
  await g.apply([{ entity: { eid: session }, session: {} }], {
    trusted: true,
  })
  let framing = 'On the phone, you said: '
  await g.apply([
    said(0, framing + 'Hi Jeffrey, Elihu here. How can I help?', {
      notice: {},
      operator_call: { call: 'c1', said: true },
      operator_channel: { channel: 'voice', framing },
    }),
    // Older still: before its channel, given one first.
    said(1, framing + 'Certainly.', {
      notice: {},
      operator_call: { call: 'c1', said: true },
    }),
  ], { trusted: true })
  await channeled(g)
  assertEquals(
    (await g.get(ids.slice(0, 2))).map((b) => [
      (b.content as Comp).body,
      b.notice,
      b.channel ?? b.operator_channel,
    ]),
    [
      ['Hi Jeffrey, Elihu here. How can I help?', { own: true }, undefined],
      ['Certainly.', { own: true }, undefined],
    ],
  )
})

// A store that keeps marks is moved once, not once an incarnation: what
// nothing writes any more is never searched for again.
test('a store moved once is not searched again by its next incarnation', async () => {
  let kept = new Map<string, string>()
  let marks = { get: (k: string) => kept.get(k), set: kept.set.bind(kept) }
  let { g, storage } = operatorMemory()
  await g.apply([{ entity: { eid: session }, session: {} }], {
    trusted: true,
  })
  await channeled(g, marks)
  await g.apply([said(0, 'By email: Hello')], { trusted: true })
  let { g: woken } = operatorMemory(storage)
  await channeled(woken, marks)
  assertEquals((await woken.get([ids[0]]))[0].channel, undefined)
})

// A line kept in the Operator's old word says it in @yaks/session's, a batch
// an alarm, and a store whose pass is done reads nothing again.
test("a line's channel moves to @yaks/session's word, in batches, once", async () => {
  let kept = new Map<string, string>()
  let marks = { get: (k: string) => kept.get(k), set: kept.set.bind(kept) }
  let { g } = operatorMemory()
  await g.apply([{ entity: { eid: session }, session: {} }], {
    trusted: true,
  })
  let old = Array.from({ length: 51 }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session },
    content: { body: `By text: ${i}` },
    operator_channel: { channel: 'text', framing: 'By text: ' },
  }))
  await g.apply(old, { trusted: true })
  let store = { g, marks }
  let passes = [await channelBackfill(store), await channelBackfill(store)]
  assertEquals([...passes, await channelBackfill(store)], [true, false, false])
  assertEquals(kept.get(CHANNELS), 'done')
  assertEquals((await g.read('.operator_channel')).length, 0)
  assertEquals(
    (await g.read('.channel.name=text&.fields=channel.framing')).length,
    51,
  )
})
