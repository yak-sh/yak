// The three pure seams: what a save writes and what it refuses, the filter
// line a recall asks with, and the passage an agent is handed.
import { assert, assertEquals, assertThrows } from '@std/assert'
import {
  BYTES,
  clamped,
  EMPTY,
  heard,
  LAST,
  line,
  type Memory,
  ordered,
  passage,
  saved,
} from './mod.ts'

let said = (over: Partial<Memory> = {}): Memory => ({
  eid: 'm1',
  said: 'use grams, never cups',
  context: '',
  about: '',
  by: 'Jeff',
  at: '2026-09-06T00:00:00.000Z',
  ...over,
})

Deno.test('a save keeps the words and says nothing about them', () => {
  let [b] = saved({ eid: 'm1', said: '  use grams, never cups  ', space: 's1' })
  assertEquals(b.entity, { eid: 'm1' })
  // Verbatim but for the whitespace around it, and in doc.body, where a
  // store's search index reads it.
  assertEquals(b.doc, { body: 'use grams, never cups' })
  // Nothing said is nothing written: no empty context, no empty about.
  assertEquals(b.memory, { space: 's1' })
})

Deno.test('a memory with no sentence in it is refused', () => {
  let no = assertThrows(
    () => saved({ eid: 'm1', said: '   \n ', space: 's1' }),
    Error,
  )
  assertEquals(no.message, EMPTY)
})

Deno.test('the context is two lines, and never the summary', () => {
  assertEquals(clamped('  one  \n\n two \nthree\nfour'), 'one\ntwo')
  assertEquals(clamped('\n\n'), '')
  let [b] = saved({
    eid: 'm1',
    said: 'x',
    space: 's1',
    about: ' recipes ',
    context: 'we were looking at\nthe recipe app\nand then at the chores one',
  })
  assertEquals(b.memory, {
    space: 's1',
    context: 'we were looking at\nthe recipe app',
    about: 'recipes',
  })
})

Deno.test('the filter line names what a row must carry', () => {
  assertEquals(
    line({ space: 's1', limit: 8 }),
    '.memory.space=s1&.doc?&.created?&.order=-entity.num&.limit=8',
  )
  // With words the store ranks them, so nothing asks for an order.
  assertEquals(
    line({ space: 's1', limit: 3, said: 'measurements' }),
    'measurements&.memory.space=s1&.doc?&.created?&.limit=3',
  )
  // The line's own punctuation cannot ride in on a person's words.
  assertEquals(
    line({ space: 's1', limit: 3, said: '.doc!&how do they  like it?' }),
    'doc how do they like it&.memory.space=s1&.doc?&.created?&.limit=3',
  )
  // A ranker answered with ids: the store is asked for those, and the space
  // still bounds it, so one space cannot rank another's memories in.
  assertEquals(
    line({ space: 's1', limit: 2, eids: ['a', 'b'] }),
    '.eid=a,b&.memory.space=s1&.doc?&.created?&.limit=2',
  )
})

Deno.test('a bundle reads back whole, and a byline speaks human', () => {
  assertEquals(
    heard({
      entity: { eid: 'm1' },
      doc: { body: 'use grams' },
      memory: { space: 's1', context: 'the recipe app', about: 'recipes' },
      created: { at: 'then', by: { eid: 'p1', name: 'Jeff' } },
    }),
    {
      eid: 'm1',
      said: 'use grams',
      context: 'the recipe app',
      about: 'recipes',
      by: 'Jeff',
      at: 'then',
    },
  )
  // A byline the store answered as a bare id, and a bundle wearing nothing.
  assertEquals(heard({ entity: { eid: 'm2' }, created: { by: 'p1' } }).by, 'p1')
  assertEquals(heard({ entity: { eid: 'm2' } }).said, '')
})

Deno.test("the ranker's order is the answer's order", () => {
  let held = [said({ eid: 'a' }), said({ eid: 'b' }), said({ eid: 'c' })]
  assertEquals(ordered(['c', 'a'], held).map((m) => m.eid), ['c', 'a'])
  // An id the store did not answer for — a memory since deleted — drops out.
  assertEquals(ordered(['z', 'b'], held).map((m) => m.eid), ['b'])
})

Deno.test('the passage says the sentence whole, with its context under it', () => {
  assertEquals(passage({ name: 'Jeff', space: 'ada' }, []), '')
  let out = passage({ name: 'Jeff', space: 'ada' }, [
    said({ about: 'recipes', context: 'looking at the recipe app' }),
    said({ eid: 'm2', said: 'keep it soft, not technical', by: 'Ana' }),
  ])
  assert(out.startsWith('## What Jeff has said\n'), out)
  assert(out.includes('In ada,'), out)
  assert(out.includes('"use grams, never cups"'), out)
  assert(out.includes('\n  about the recipes app'), out)
  assert(out.includes('\n  looking at the recipe app'), out)
  // Somebody else in the space is named; the person the heading is about is
  // not named again on every line.
  assert(out.includes('"keep it soft, not technical" — Ana'), out)
  assert(!out.includes('— Jeff'), out)
  assert(!out.includes('memory_recall finds'), 'nothing was left out')
})

Deno.test('the passage is bounded by both the count and the bytes', () => {
  let many = Array.from(
    { length: LAST + 3 },
    (_, i) => said({ eid: `m${i}`, said: `sentence ${i}` }),
  )
  let out = passage({ name: 'Jeff', space: 'ada' }, many)
  assertEquals(out.match(/sentence /g)?.length, LAST)
  assert(out.includes('memory_recall finds'), out)
  // And the bytes stop it sooner: one long sentence fits, the next does not.
  let long = Array.from(
    { length: 4 },
    (_, i) => said({ eid: `m${i}`, said: 'x'.repeat(BYTES - 100) }),
  )
  let cut = passage({ name: 'Jeff', space: 'ada' }, long)
  assertEquals(cut.match(/"x/g)?.length, 1)
  assert(cut.includes('memory_recall finds'), cut)
  // A person with no name is still somebody.
  assert(
    passage({ name: '', space: 'ada' }, [said()])
      .startsWith('## What the person has said'),
  )
})
