/** A capped tree keeps expensive paths and accounts for folded work exactly
 * once through inclusive parent metrics, without mutating the recording. */
import { equal, ok, test } from '@yaks/testing'
import type { Event } from '@yaks/trace'
import { sampleRequest, TRACE_MAX_SPANS } from './mod.ts'
import { cap } from './cap.ts'

let event = (id: string, parent?: string, read = 1, duration = 0): Event => ({
  id,
  parent,
  kind: parent ? 'sql' : 'request',
  name: 'query',
  stage: 'end',
  time: 0,
  duration,
  counts: { rowsRead: read, rowsWritten: read * 2, statements: read },
})

test('cap keeps expensive rows before time, with ancestors and stable ties', () => {
  let spans = [
    event('root', undefined, 10_000),
    event('phase', 'root', 500),
    event('hot', 'phase', 500),
    ...Array.from({ length: 5000 }, (_, i) => event(String(i), 'root')),
    event('slow', 'root', 1, 100),
    event('row', 'root', 2),
  ]
  let before = structuredClone(spans)
  let kept = cap(spans), ids = new Set(kept.map((e) => e.id))
  equal(kept.length, TRACE_MAX_SPANS)
  for (let id of ['root', 'phase', 'hot', 'slow', 'row', '0']) ok(ids.has(id))
  equal(ids.has('4999'), false)
  for (let e of kept) if (e.parent) ok(ids.has(e.parent))
  equal(spans, before)
  equal(cap(spans), kept)
})

test('folded branches and direct work remain in inclusive counts, not added twice', () => {
  // The hot branch is retained; 5,000 cold statements and direct root work are
  // folded into the root. Metrics are inclusive at each depth, not additive.
  let spans = [
    event('root', undefined, 6010),
    event('branch', 'root', 1000),
    event('hot', 'branch', 1000),
    ...Array.from({ length: 5000 }, (_, i) => event(String(i), 'root')),
  ]
  let rows = sampleRequest(spans, {
    requested: true,
    rowsRead: 6010,
    rowsWritten: 12020,
    eid: 'a3f19c02-4b00-4000-8000-000000000001',
    origin: 0,
  })!.slice(1)
  equal(rows.length, TRACE_MAX_SPANS)
  for (let key of ['rows_read', 'rows_written', 'statements'] as const) {
    let exclusive = rows.map((row) =>
      row[key]!.n - rows
        .filter((child) => child.span!.parent == row.entity.eid)
        .reduce((n, child) => n + child[key]!.n, 0)
    )
    ok(exclusive.every((n) => n >= 0))
    equal(exclusive.reduce((a, b) => a + b, 0), rows[0][key]!.n)
    equal(
      rows[0][key]!.n,
      spans[0].counts![
        key == 'rows_read'
          ? 'rowsRead'
          : key == 'rows_written'
          ? 'rowsWritten'
          : 'statements'
      ],
    )
  }
})

test('an over-cap ancestor path folds whole, while fitting sibling work remains', () => {
  let spans = [event('root', undefined, 1)]
  for (let i = 0; i < 250; i++) {
    spans.push(event(
      String(i),
      i ? String(i - 1) : 'root',
      0,
    ))
  }
  spans.push(event('too-deep', '249', 1), event('sibling', 'root', 1))
  let kept = cap(spans)
  equal(kept.some((e) => e.id == 'too-deep'), false)
  equal(kept.some((e) => e.id == 'sibling'), true)
  ok(kept.length <= TRACE_MAX_SPANS)
})
