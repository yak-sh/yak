import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { answerOf } from './answer.ts'

let vocab = loadVocab([sessionDoc, toolsDoc])
let g = graph({ storage: ram(vocab), vocab })
let lines = (session: string, ...said: object[]) =>
  said.map((b, i) => ({
    entity: { eid: `${session}-${i + 1}` },
    entry: { session, seq: i + 1 },
    ...b,
  }))
let words = (body: string) => ({ content: { body } })
let reply = (body: string) => ({ content: { body }, output: {} })
// A conversation asked twice: the second words start a helper, whose report
// comes back after a quick word and is answered.
await g.apply([
  { entity: { eid: 'talk' }, session: {} },
  {
    entity: { eid: 'helper' },
    session: {},
    spawned: { parent: 'talk', call: 'talk-4' },
  },
  ...lines(
    'talk',
    words('What is due?'),
    reply('Nothing today.'),
    words('Check the app'),
    { call: {} },
    reply('Looking into it.'),
    {
      ...words('child helper settled\nIt is fine.'),
      delivery: { child: 'helper' },
    },
    reply('The app is fine.'),
  ),
  ...lines('helper', words('Check the app'), reply('It is fine.')),
  // Words given while a reply was being written (`late-4`) are the next
  // reply's: the first answers only what its ask was sent with.
  { entity: { eid: 'late' }, session: {} },
  ...lines(
    'late',
    words('Write the guide'),
    { ask: { through: 'late-1' } },
    words('And the logo?'),
    { ...reply('The guide.'), output: { source: 'late-2' } },
  ),
  { entity: { eid: 'stopped' }, session: {} },
  ...lines(
    'stopped',
    words('Tidy up'),
    { stop: {}, content: { body: 'Stopped by the person watching.' } },
  ),
])

test("a conversation's turn answers the words its helper's report stands for", async () => {
  let answer = await answerOf(g, 'talk')
  assertEquals(
    [
      answer.text,
      answer.mark?.entity.eid,
      answer.given.map((b) => b.entity.eid),
    ],
    ['The app is fine.', 'talk-6', ['talk-3']],
  )
})

test("a helper's turn answers nobody's words: its report is its parent's", async () => {
  let answer = await answerOf(g, 'helper')
  assertEquals([answer.text, answer.given], ['It is fine.', []])
})

test('a stopped turn answers its words with the stop, and is no fault', async () => {
  let answer = await answerOf(g, 'stopped')
  assertEquals(
    [answer.text, answer.fault, answer.given.map((b) => b.entity.eid)],
    ['Stopped by the person watching.', undefined, ['stopped-1']],
  )
})

test('a reply answers the words its ask heard, not those given while it was written', async () => {
  let first = await answerOf(g, 'late')
  let [ask, logo] = lines(
    'late',
    ...Array(4),
    { ask: { through: 'late-4' } },
    { ...reply('Logo set.'), output: { source: 'late-5' } },
  ).slice(4)
  await g.apply([ask, logo])
  let next = await answerOf(g, 'late')
  assertEquals(
    [first, next].map((a) => [
      a.text,
      a.mark?.entity.eid,
      a.given.map((b) => b.entity.eid),
    ]),
    [['The guide.', 'late-1', ['late-1']], [
      'Logo set.',
      'late-3',
      ['late-3'],
    ]],
  )
})
