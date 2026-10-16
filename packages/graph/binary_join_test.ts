/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { filled, match, narrowed } from './join.ts'

let bytes = new Uint8Array([0, 255, 128])
let plan = match('$d .document.bytes=$bytes')
test('byte variable bindings keep their content when filling and narrowing matches', () => {
  equal(filled(plan, { bytes }).patterns[0].filter.clauses.at(-1), {
    kind: 'pred',
    path: ['document', 'bytes'],
    op: '=',
    value: { kind: 'scalar', raw: 'AP+A' },
  })
  equal(
    narrowed(plan, { bytes: [bytes, bytes.slice()] }).patterns[0].filter.clauses
      .at(-1),
    {
      kind: 'pred',
      path: ['document', 'bytes'],
      op: '=',
      value: { kind: 'list', items: [{ kind: 'scalar', raw: 'AP+A' }] },
    },
  )
})
