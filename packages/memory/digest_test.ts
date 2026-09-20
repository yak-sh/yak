import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { memoryDoc } from './vocab.ts'
import { digest, RECALL } from './digest.ts'

let vocab = loadVocab([docDoc, memoryDoc], [idKeywords])

// What the store was asked, and what it hands back. A `rows` function answers
// per question, so one store can hold claims, entries and memories at once.
let asked: string[] = []
let store = (rows: Bundle[] | ((q: string) => Bundle[])) => (q: unknown) => {
  asked.push(String(q))
  let said = String(q)
  let out = typeof rows == 'function' ? rows(said) : rows
  // Only a memory question answers memories; the rest are the session's own.
  return typeof rows == 'function' ? out : said.includes('.memory') ? out : []
}

// The one refusal a store makes where nobody composed @yaks/embedding.
let noVectors = (q: string) => {
  if (q.includes('.near=')) {
    throw Object.assign(new Error('cannot compile .near'), { feature: '.near' })
  }
}

let m = (num: number, title: string, scope?: string, body = ''): Bundle => ({
  entity: { eid: `m${num}`, num },
  memory: scope ? { scope } : {},
  doc: { title, ...(body ? { body } : {}) },
})

let told = async (
  actor: string | undefined,
  rows: Bundle[] | ((q: string) => Bundle[]),
  options = {},
  eid = 's1',
) => {
  asked = []
  return await digest({ vocab }, options)(
    { entity: { eid }, session: { id: 'abc', actor } },
    store(rows),
  )
}

Deno.test('the memories are pointers: an id and a title', async () => {
  assertEquals(
    await told('p1', [m(1, 'Fork the work, not the knowing')]),
    [{ heading: 'recall', lines: ['- M-1 — Fork the work, not the knowing'] }],
  )
  // Nothing held and nothing typed: the newest, bounded — the whole of what
  // every store can answer.
  let memories = asked.find((q) => q.includes('.memory'))!
  assertEquals(memories.includes('.order=-entity.num'), true)
  assertEquals(memories.includes(`.limit=${RECALL * 4}`), true)
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
  assertEquals(
    asked.find((q) => q.includes('.memory'))!.includes('.limit=8'),
    true,
  )
})

Deno.test('a graph with no memories writes no section', async () => {
  assertEquals((await told('p1', []))[0].lines, [])
})

// The claimed work and the owner's last lines, as one question to the store.
let held: Bundle = {
  entity: { eid: 't7', num: 7 },
  claim: { session: 's1' },
  doc: { title: 'Recall the nearest memories' },
}
let typed: Bundle = {
  entity: { eid: 'e1', num: 9 },
  entry: { session: 's1' },
  content: { body: 'make the digest useful' },
}

Deno.test('what it holds and what the owner typed become the words', async () => {
  let rows = [m(1, 'newest'), m(2, 'nearest'), m(3, 'older')]
  await told('p1', (q) => {
    if (q.startsWith('.claim')) return [held]
    if (q.startsWith('.entry')) return [typed]
    return rows
  })
  assertEquals(asked[0], '.claim.session="s1"&.doc?')
  assertEquals(
    asked[1],
    '.entry.session.session.actor="p1"' +
      '&.content&!output&!result&!error&!exception' +
      '&.order=-entity.num&.limit=5',
  )
  // Any one word is enough, each word said once, and the anchor is what it
  // holds — nearest among the memories the words selected.
  assertEquals(
    asked[2],
    '("recall"|"the"|"nearest"|"memories"|"make"|"digest"|"useful")' +
      '&.near=t7&.memory&.doc?&.created?&.order=similar&.limit=24',
  )
})

Deno.test('a transcript nothing has minted yet holds nothing to ask about', async () => {
  await told('p1', [], {}, '$session')
  assertEquals(asked.some((q) => q.startsWith('.claim')), false)
  assertEquals(asked[0].startsWith('.entry'), true)
})

Deno.test('a store with no vectors is asked once, then never again', async () => {
  let rows = [m(1, 'the newest one'), m(2, 'nearest memories, recalled')]
  let answer = (q: string) => {
    noVectors(q)
    if (q.startsWith('.claim')) return [held]
    if (q.startsWith('.entry')) return [typed]
    return rows
  }
  asked = []
  // One factory, two transcripts: the refusal settles it for the host.
  let sections = digest({ vocab })
  let s = { entity: { eid: 's1' }, session: { id: 'abc', actor: 'p1' } }
  // The refusal is caught, the words alone answer, and the memory saying most
  // of what this session is about leads.
  assertEquals((await sections(s, store(answer)))[0].lines, [
    '- M-2 — nearest memories, recalled',
    '- M-1 — the newest one',
  ])
  await sections(s, store(answer))
  assertEquals(asked.filter((q) => q.includes('.near=')).length, 1)
})
