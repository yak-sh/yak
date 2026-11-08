// A session's computed status costs its newest turn, however many turns its
// transcript holds: every get of a conversation's `session` component reads it.
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { effectDoc } from '@yaks/effects'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { stepping } from '../sqlite/testing.ts'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  sessionDoc,
  toolsDoc,
  modelDoc,
  effectDoc,
  archetypeDoc,
], [kernelKeywords])

// A turn of the transcript `session`: the person's words, the model asked,
// and the prose it answered.
let turn = (session: string, n: number) => [
  {
    entity: { eid: `${session}-said-${n}` },
    entry: { session, seq: 3 * n + 1 },
    content: { body: `words ${n}` },
  },
  {
    entity: { eid: `${session}-ask-${n}` },
    entry: { session, seq: 3 * n + 2 },
    ask: { through: `${session}-said-${n}` },
  },
  {
    entity: { eid: `${session}-reply-${n}` },
    entry: { session, seq: 3 * n + 3 },
    content: { body: `reply ${n}` },
    output: { source: `${session}-ask-${n}` },
  },
]
let turns = (session: string, count: number) =>
  Array.from({ length: count }, (_, n) => turn(session, n)).flat()

// What reading `chat`, `long` turns long, costs, and reading a transcript
// holding only the person's words beside `apart` others a turn each, the way
// the Operator keeps a transcript a turn. 64 asks or fewer is a store small
// enough that a search for an unsequenced ask reads all of them.
let cost = async (long: number, apart: number) => {
  let { driver, steps } = stepping()
  let s = storage(driver, vocab, { derived: sessionDerived(vocab) })
  s.install()
  s.raise()
  let g = graph({ storage: s, vocab })
  let others = Array.from({ length: apart }, (_, n) => `t${n}`)
  await g.apply([
    ...['chat', 'new', ...others].map((eid) => ({
      entity: { eid },
      session: {},
    })),
    ...turns('chat', long),
    ...others.flatMap((t) => turns(t, 1)),
    turn('new', 0)[0],
  ], { trusted: true })
  let read = async (eid: string, status: string) => {
    await g.get([eid], ['session'])
    let before = steps()
    let [row] = await g.get([eid], ['session'])
    equal((row.session as { status: string }).status, status)
    return steps() - before
  }
  let query = '.entity.eid=chat .session.status=running .fields=entity.eid'
  await g.read(query)
  let before = steps()
  equal(await g.read(query), [])
  let filtered = steps() - before
  return [
    await read('chat', 'settled'),
    await read('new', 'running'),
    filtered,
  ]
}

test('reading a session costs its newest turn, not its transcript', async () => {
  let [few] = await cost(5, 0), [many] = await cost(60, 0)
  ok(many < few * 1.2, `${few} VM steps at 5 turns, ${many} at 60`)
})

test("reading a session costs its newest turn, not the store's asks", async () => {
  let [, few] = await cost(1, 4), [, many] = await cost(1, 59)
  ok(many < few * 1.2, `${few} VM steps beside 5 asks, ${many} beside 60`)
})

test('filtering a session costs its newest turn, not its transcript', async () => {
  let [, , few] = await cost(5, 0), [, , many] = await cost(60, 0)
  ok(many < few * 1.2, `${few} VM steps at 5 turns, ${many} at 60`)
})

let history = async (size: number, ended = false) => {
  let { driver, steps } = stepping()
  let s = storage(driver, vocab, { derived: sessionDerived(vocab) })
  s.install()
  let g = graph({ storage: s, vocab })
  await g.apply([
    { entity: { eid: 'chat' }, session: { ended } },
    {
      entity: { eid: 'input' },
      entry: { session: 'chat', seq: 1 },
      content: { body: 'hello' },
    },
    { entity: { eid: 'stop' }, entry: { session: 'chat', seq: 2 }, stop: {} },
    {
      entity: { eid: 'resume' },
      entry: { session: 'chat', seq: 3 },
      content: { body: 'continue' },
    },
    ...Array.from({ length: size }, (_, i) => ({
      entity: { eid: `output-${i}` },
      entry: { session: 'chat', seq: i + 4 },
      content: { body: 'prose' },
      output: { source: 'chat' },
    })),
    ...ended
      ? [{
        entity: { eid: 'ask' },
        entry: { session: 'chat', seq: size + 4 },
        ask: {},
      }]
      : [],
  ], { trusted: true })
  let query = '.session.status=stopped .fields=entity.eid'
  await g.read(query)
  return async () => {
    let before = steps()
    equal((await g.read(query)).map((b) => b.entity.eid), ended ? ['chat'] : [])
    return steps() - before
  }
}
let brief = await history(10), long = await history(1000)
let stoppedBrief = await history(10, true),
  stoppedLong = await history(1000, true)

test('a stopped filter skips resumed transcripts without reading their history', async () => {
  let few = await brief(), many = await long()
  ok(many < few * 1.2, `${few} VM steps at 10 outputs, ${many} at 1000`)
})

test('an ended unanswered ask stops without reading its history', async () => {
  let few = await stoppedBrief(), many = await stoppedLong()
  ok(many < few * 1.2, `${few} VM steps at 10 outputs, ${many} at 1000`)
})
