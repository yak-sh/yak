import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { workflow } from './workflow.ts'

let step = (eid: string): Bundle => ({
  entity: { eid },
  builder: { query: `.${eid}` },
  doc: { title: eid },
})
let needs = (from: string, to: string): Bundle => ({
  entity: { eid: `${from}>${to}` },
  edge: { from, to },
  requires: {},
})
let stages = (rows: Bundle[]) =>
  workflow(rows).map((stage) => stage.map((s) => s.eid))

test('a workflow runs each step once every step it requires has', () => {
  // The video pipeline: voices and lines both wait on the script, and
  // assembling waits on both.
  assertEquals(
    stages([
      step('assemble'),
      step('lines'),
      step('voices'),
      step('script'),
      needs('voices', 'script'),
      needs('lines', 'script'),
      needs('lines', 'voices'),
      needs('assemble', 'lines'),
      needs('assemble', 'voices'),
    ]),
    [['script'], ['voices'], ['lines'], ['assemble']],
  )
  assertEquals(
    stages([
      step('a'),
      step('b'),
      step('c'),
      needs('b', 'a'),
      needs('c', 'a'),
    ]),
    [['a'], ['b', 'c']],
  )
})

test('every builder is drawn, a loop of requirements or a link to a non-builder included', () => {
  assertEquals(
    stages([step('a'), step('b'), needs('a', 'b'), needs('b', 'a')]),
    [['a', 'b']],
  )
  assertEquals(
    workflow([step('a'), needs('a', 'task')]),
    [[{ eid: 'a', title: 'a', requires: [] }]],
  )
})
