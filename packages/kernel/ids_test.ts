import { assertEquals } from '@std/assert'
import type { Bundle, Tx } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ids } from './ids.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: { component: true, type: 'object', kind: true },
    task: { component: true, type: 'object', kind: true, prefix: 'T' },
    memory: { component: true, type: 'object', kind: true, prefix: 'M' },
  },
}
let vocab = loadVocab([doc], [idKeywords])

// The store, as far as addressing is concerned: the entities numbered so far.
let rows: Bundle[] = [
  // A task is a doc too, so it answers to both letters — which is the point:
  // whichever kind wins the display, the id a person typed still lands.
  { entity: { eid: 'a', num: 7 }, task: {}, doc: {} },
  { entity: { eid: 'b', num: 9 }, memory: {} },
]
let asked: string[] = []
let tx = {
  read: (q: string) => {
    asked.push(String(q))
    let want = String(q).slice('.entity.num='.length).split(',').map(Number)
    return rows.filter((r) => want.includes(Number(r.entity.num)))
  },
} as unknown as Tx

let at = async (...said: string[]) =>
  Object.fromEntries(await ids(vocab).address!(tx, said))

Deno.test('a human id is the entity wearing that number', async () => {
  assertEquals(await at('T-7'), { 'T-7': 'a' })
  assertEquals(await at('M-9'), { 'M-9': 'b' })
})

Deno.test('the number is the identity; the letter only has to agree', async () => {
  assertEquals(await at('7'), { '7': 'a' })
  assertEquals(await at('t-7'), { 't-7': 'a' })
  // Every kind it wears answers for it: entity 7 is a task and a doc.
  assertEquals(await at('D-7'), { 'D-7': 'a' })
  // M-7 is nobody: entity 7 is neither a memory nor anything else with an M.
  assertEquals(await at('M-7'), {})
  // T-9 is nobody either: entity 9 is a memory.
  assertEquals(await at('T-9'), {})
})

Deno.test('an eid, a name and an unnumbered id address nothing here', async () => {
  asked = []
  assertEquals(await at('a', 'some-name'), {})
  assertEquals(asked, [])
  assertEquals(await at('T-404'), {})
})

Deno.test('every id on the line costs one read', async () => {
  asked = []
  assertEquals(await at('T-7', 'M-9', '7'), {
    'T-7': 'a',
    'M-9': 'b',
    '7': 'a',
  })
  assertEquals(asked, ['.entity.num=7,9'])
})
