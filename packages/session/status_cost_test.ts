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
  return [await read('chat', 'settled'), await read('new', 'running')]
}

test('reading a session costs its newest turn, not its transcript', async () => {
  let [few] = await cost(5, 0), [many] = await cost(60, 0)
  ok(many < few * 1.2, `${few} VM steps at 5 turns, ${many} at 60`)
})

test("reading a session costs its newest turn, not the store's asks", async () => {
  let [, few] = await cost(1, 4), [, many] = await cost(1, 59)
  ok(many < few * 1.2, `${few} VM steps beside 5 asks, ${many} beside 60`)
})
