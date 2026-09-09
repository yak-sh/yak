// The production package vocabulary belongs to a SQL handle, independently of
// the legacy app vocabulary. Building it needs no SQL and never opens a graph.
import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
} from '@std/assert'
import { fleetVocabOf, ownsVocab, vocabOf } from '../db.ts'
import { DatabaseSync } from './sqlite.ts'

let a = new DatabaseSync(':memory:')
let b = new DatabaseSync(':memory:')
let first = fleetVocabOf(a)
let second = fleetVocabOf(b)
a.close()
b.close()

Deno.test('fleet vocabulary: memoized per handle without planting app vocabulary', () => {
  assertStrictEquals(fleetVocabOf(a), first)
  assertStrictEquals(fleetVocabOf(b), second)
  assertNotStrictEquals(first, second)
  assertEquals(first.route('priority'), second.route('priority'))
  assertEquals(first.column('task', 'status')!.persist, false)
  assertEquals(ownsVocab(a), false)
  assertEquals(vocabOf(a), {})
})
