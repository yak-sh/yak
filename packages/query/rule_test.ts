// A query read as a rule: which half an evaluator is handed, and which half is
// the engine's. The gate is the interesting one — it is both.

import { assertEquals } from '@std/assert'
import { absent, and, declared, parse, present } from './mod.ts'

Deno.test('declared splits the filter from the instructions', () => {
  let r = declared(parse('.entity, +!created, *created, #clock, $e'))
  assertEquals(r.filter, and(present('entity'), absent('created')))
  assertEquals(r.gates, ['created'])
  assertEquals(r.writes, ['created'])
  assertEquals(r.resources, ['clock'])
  assertEquals(r.vars, ['e'])
  assertEquals(r.ensures, [])
})

Deno.test('an ensure filters nothing', () => {
  let r = declared(parse('.task, +touched'))
  assertEquals(r.filter, and(present('task')))
  assertEquals(r.ensures, ['touched'])
})

// A query with no sigils reads as a rule that only filters.
Deno.test('a plain query declares nothing', () => {
  let r = declared(parse('.status=open'))
  assertEquals(r.filter.clauses.length, 1)
  assertEquals([r.ensures, r.gates, r.writes, r.resources, r.vars], [
    [],
    [],
    [],
    [],
    [],
  ])
})
