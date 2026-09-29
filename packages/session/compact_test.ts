// Compaction keeps a model transcript valid while replacing an old prefix
// with its summary.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { prefix } from './compact.ts'

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
  assertEquals(prefix(entries, 1_000).map((b) => b.entity.eid), ['e1', 'e2'])
})
