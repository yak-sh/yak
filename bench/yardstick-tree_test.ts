import { equal, ok, test } from '@yaks/testing'
import { edit, emit, init } from './yardstick-tree.ts'

await init()
let source = 'const π = "😀"; let a = 12; function f() { return a + π; }'
let before = emit('fixture.ts', source)
let diff = edit('fixture.ts', source, before)
let next = new Map(diff.after.nodes.map((r) => [r.entity.eid, r.node]))
let prior = new Map(before.nodes.map((r) => [r.entity.eid, r.node]))
let bytes = new TextEncoder().encode(source)

test('yardstick emits anonymous syntax and UTF-8 spans', () => {
  equal(before.nodes[0].node.end, bytes.length)
  ok(before.nodes.some((r) => r.node.kind == ';'))
  let literal = before.nodes.find((r) => r.node.kind == 'number')!.node
  equal(new TextDecoder().decode(bytes.slice(literal.start, literal.end)), '12')
  equal(before.errors, 0)
})

test('yardstick edit retains unchanged identities and reconstructs every parent', () => {
  let f = before.nodes.find((r) => r.node.kind == 'function_declaration')!
  equal(next.get(f.entity.eid)?.kind, 'function_declaration')
  equal(next.get(f.entity.eid)?.start, f.node.start + 6)
  ok(diff.writes.some((r) => r.$delete))
  ok(diff.writes.some((r) => r.entity.eid.includes('#edit-')))
  equal(new Set(next.keys()).size, diff.after.nodes.length)
  for (let row of diff.after.nodes) {
    if (row.node.parent) ok(next.has(row.node.parent))
  }
  let applied = new Map(prior)
  for (let row of diff.writes) {
    if (row.$delete) applied.delete(row.entity.eid)
    else if ('node' in row) {
      applied.set(row.entity.eid, row.node as typeof f.node)
    }
  }
  equal([...applied].sort(), [...next].sort())
})

test('yardstick reference fixture is file-local and points to live syntax', () => {
  ok(diff.after.references.length > 0)
  for (let row of diff.after.references) {
    let ref = row.reference as { source: string; target: string }
    ok(next.has(ref.source))
    ok(next.has(ref.target))
    equal(row.entity.eid, `ref:${ref.source}`)
  }
})
