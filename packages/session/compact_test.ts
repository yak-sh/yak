// Compaction keeps a model transcript valid while replacing an old prefix
// with its summary.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { context, prefix, suffix } from './compact.ts'

let entry = (
  seq: number,
  comps: Record<string, Record<string, unknown>>,
): Bundle => ({ entity: { eid: `e${seq}` }, entry: { seq }, ...comps })

test('a compaction prefix does not split an interleaved call and result', () => {
  let entries = [
    entry(1, { content: { body: 'x'.repeat(160) } }),
    entry(2, { ask: { to: 'model' } }),
    entry(3, { call: { to: 'tool', id: 'c1' } }),
    entry(4, { content: { body: 'arrived while the call ran' } }),
    entry(5, { result: { call: 'e3' }, content: { body: 'done' } }),
  ]
  let cut = (keep: number) =>
    prefix(entries, [40, 1, 1, 1, 1], keep).map((b) => b.entity.eid)
  assertEquals(cut(3), ['e1', 'e2'])
  // The only cut keeping two lines would part the result from its call.
  assertEquals(cut(2), ['e1', 'e2', 'e3', 'e4', 'e5'])
})

test('progress stays paired with its call across windows and checkpoints', () => {
  let entries = [
    entry(1, { content: { body: 'start' } }),
    entry(2, { call: { to: 'tool', id: 'c1' } }),
    entry(3, { tool_progress: { call: 'e2' }, content: { body: 'working' } }),
    entry(4, { content: { body: 'later input' } }),
  ]
  assertEquals(suffix(entries, 2).map((b) => b.entity.eid), ['e2', 'e3', 'e4'])
  assertEquals(prefix(entries, [40, 1, 1, 1], 3).map((b) => b.entity.eid), [
    'e1',
  ])
  let mark = entry(5, {
    checkpoint: { through: 'e2' },
    content: { body: 'summary' },
  })
  assertEquals(context([...entries, mark]).map((b) => b.entity.eid), [
    'e5',
    'e2',
    'e3',
    'e4',
  ])
})
