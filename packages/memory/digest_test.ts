import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { memoryDoc } from './vocab.ts'
import { digest, RECALL } from './digest.ts'

let vocab = loadVocab([docDoc, memoryDoc], [idKeywords])

// What the store was asked, and what it hands back.
let asked: string[] = []
let store = (rows: Bundle[]) => (q: unknown) => {
  asked.push(String(q))
  return rows
}

let m = (num: number, title: string, scope?: string): Bundle => ({
  entity: { eid: `m${num}`, num },
  memory: scope ? { scope } : {},
  doc: { title },
})

let told = async (actor: string | undefined, rows: Bundle[], options = {}) => {
  asked = []
  return await digest({ vocab }, options)(
    { entity: { eid: 's1' }, session: { id: 'abc', actor } },
    store(rows),
  )
}

Deno.test('the memories are pointers: an id and a title', async () => {
  assertEquals(
    await told('p1', [m(1, 'Fork the work, not the knowing')]),
    [{ heading: 'recall', lines: ['- M-1 — Fork the work, not the knowing'] }],
  )
  // Newest first, and bounded — the whole of what every store can answer.
  assertEquals(asked[0].includes('.order=-entity.num'), true)
  assertEquals(asked[0].includes(`.limit=${RECALL * 4}`), true)
})

Deno.test('a memory with no title is still a pointer', async () => {
  let said = await told('p1', [{ entity: { eid: 'm2', num: 2 }, memory: {} }])
  assertEquals(said[0].lines, ['- M-2'])
})

Deno.test("a scoped memory is this project's, an unscoped one everybody's", async () => {
  let rows = [m(1, 'everywhere'), m(2, 'mine', 'p1'), m(3, 'theirs', 'p2')]
  assertEquals((await told('p1', rows))[0].lines, [
    '- M-1 — everywhere',
    '- M-2 — mine',
  ])
  assertEquals((await told(undefined, rows))[0].lines, ['- M-1 — everywhere'])
})

Deno.test('a memory filtered out does not eat a place in the answer', async () => {
  let rows = [m(1, 'theirs', 'p2'), m(2, 'mine', 'p1'), m(3, 'also', 'p1')]
  assertEquals((await told('p1', rows, { recall: 2 }))[0].lines, [
    '- M-2 — mine',
    '- M-3 — also',
  ])
  assertEquals(asked[0].includes('.limit=8'), true)
})

Deno.test('a graph with no memories writes no section', async () => {
  assertEquals((await told('p1', []))[0].lines, [])
})
