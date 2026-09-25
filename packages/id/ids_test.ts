import { assertEquals } from '@std/assert'
import type { Bundle, Tx } from '@yaks/graph'
import { idKeywords } from './keywords.ts'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ids } from './ids.ts'
import { idDoc } from './vocab.ts'

let doc: VocabDoc = {
  $defs: {
    entity: { component: true, type: 'object', wire: false },
    doc: { component: true, type: 'object', kind: true },
    task: { component: true, type: 'object', kind: true, prefix: 'T' },
    memory: { component: true, type: 'object', kind: true, prefix: 'M' },
  },
}
let vocab = loadVocab([doc, idDoc], [idKeywords])

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
  // M-7 names nothing: entity 7 is neither a memory nor anything else with an
  // M. T-9 names nothing either: entity 9 is a memory.
  assertEquals(await at('M-7', 'T-9'), { 'M-7': null, 'T-9': null })
})

Deno.test("an eid and a name are not this plugin's to answer", async () => {
  asked = []
  assertEquals(await at('a', 'some-name'), {})
  assertEquals(asked, [])
})

Deno.test('a human id nobody wears names nothing, and says so', async () => {
  assertEquals(await at('T-404', '404'), { 'T-404': null, '404': null })
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
