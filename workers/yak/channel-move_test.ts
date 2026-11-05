import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { channeled } from './channel-move.ts'
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
    rows.map((b) => b.operator_channel as Comp | undefined).map((c) =>
      c && [c.channel, c.framing]
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
