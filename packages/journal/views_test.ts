/// <reference lib="deno.ns" />
// A history row as a terminal prints it: when, who, and what it wrote, the
// author named by its own `Title` (a process by its command).

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { define, prepared } from '@yaks/render'
import { type Shown, views as generic } from '@yaks/render/views'
import { views as processViews } from '@yaks/process/views'
import { processDoc } from '@yaks/process'
import { type Node, plain, tree } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { journalDoc } from './vocab.ts'
import { views } from './views.ts'

let vocab = loadVocab([journalDoc, processDoc])
let registry = await prepared(define([
  ...views.renderers,
  ...processViews.renderers,
  ...generic.renderers,
]))

let RUN = '00000000-0000-4000-8000-000000000001'
let held = new Map([[RUN, {
  entity: { eid: RUN },
  process: { pid: 7, command: 'yak task new Buy the cake' },
}]])
let ctx: Shown<Node> = {
  id: (b) => b.entity.eid,
  kind: () => 'entity',
  name: (eid) => eid,
  when: (at) => `at ${at}`,
  get: (eid) => held.get(eid),
  show: (b, view) => tree(registry, b, view, vocab, ctx),
}

let line = (row: Record<string, unknown>) =>
  plain(tree(
    registry,
    {
      entity: { eid: 't1' },
      _tx: { seq: 1, at: 'noon', by: RUN },
      ...row,
    },
    'Tile',
    vocab,
    ctx,
  ))

test('a row reads as when, who, and what it wrote', () => {
  assertEquals(
    line({ task: {}, doc: { title: 'Buy the cake' } }),
    'at noon · yak task new Buy the cake · task; doc: Buy the cake',
  )
  assertEquals(
    line({ completed: { at: '2026-11-03T06:10:34Z', by: RUN } }),
    'at noon · yak task new Buy the cake · completed',
  )
  assertEquals(
    line({ claim: null }),
    'at noon · yak task new Buy the cake · removed claim',
  )
  assertEquals(
    line({ $delete: true }),
    'at noon · yak task new Buy the cake · deleted',
  )
})

test('a long text is its opening words', () => {
  let said = line({ doc: { body: 'word '.repeat(40) } })
  assertEquals(said.endsWith('…'), true)
  assertEquals(said.length < 120, true)
})
