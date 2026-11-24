// A required component's own indexed equality is sought however many rows
// the component holds: the few lines of a long talk heard by chat are read
// from `heard.by`'s index, not by walking the talk from its newest line.
import { archetypeDoc } from '@yaks/archetype'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { storage } from './mod.ts'
import { seed, stepping } from './testing.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    line: {
      component: true,
      index: [['talk', 'at']],
      properties: { talk: { type: 'string' }, at: { type: 'integer' } },
    },
    heard: {
      component: true,
      properties: { by: { type: 'string', index: true } },
    },
  },
}])
let { driver, steps } = stepping()
let store = storage(driver, vocab, { counts: 'eager' })
store.install()
// A talk of `n` lines, each heard on the web but its fifth, heard by chat.
let talk = (name: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    entity: { eid: `${name}-${i}` },
    line: { talk: name, at: i },
    heard: { by: i == 4 ? 'chat' : 'web' },
  }))
seed(store, [...talk('short', 30), ...talk('long', 3000)])

let read = async (name: string) => {
  let q = `.heard.by=chat&.line.talk=${name}&.order=-line.at&.limit=50`
  await store.rows(q)
  let start = steps()
  let rows = await store.rows(q)
  return { eids: rows.map((row) => row.eid), cost: steps() - start }
}
let short = await read('short'), long = await read('long')

test("a long talk's lines heard by chat cost what a short one's do", () => {
  equal(short.eids, ['short-4'])
  equal(long.eids, ['long-4'])
  ok(long.cost < short.cost * 1.5, `${long.cost} on 3,000, ${short.cost} on 30`)
})
