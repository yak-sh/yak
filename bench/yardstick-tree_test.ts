import { equal, ok, test } from '@yaks/testing'
import {
  containingFunction,
  edit,
  emit,
  functionLiteral,
  init,
  pack,
} from './yardstick-tree.ts'

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

test('coarse packing retains all syntax, names, fixture refs and local parents', () => {
  for (let grain of ['file', 'declaration'] as const) {
    let packed = pack(before, source, grain)
    equal(packed.flatMap((p) => p.tree.value.nodes).length, before.nodes.length)
    let restored = packed.flatMap((p) =>
      p.tree.value.nodes.map((n) => {
        let eid = `${p.tree.file}#${n.id}`
        let original = prior.get(eid)!
        equal(n.start + p.tree.start, original.start)
        equal(n.end + p.tree.start, original.end)
        equal(n.ordinal, original.ordinal)
        equal(n.kind, original.kind)
        if (n.parent != null) {
          equal(
            `${p.tree.file}#${p.tree.value.nodes[n.parent].id}`,
            original.parent,
          )
        } else if (eid != before.nodes[0].entity.eid) {
          equal(original.parent, before.nodes[0].entity.eid)
        }
        if (n.kind == 'identifier' || n.kind == 'type_identifier') {
          equal(
            n.name,
            new TextDecoder().decode(bytes.slice(original.start, original.end)),
          )
        }
        return eid
      })
    )
    equal(restored.toSorted(), before.nodes.map((r) => r.entity.eid).toSorted())
    equal(
      packed.flatMap((p) => p.tree.value.nodes).filter((n) => n.target).length,
      before.references.length,
    )
  }
})

test('function edit rewrites a declaration value and only shifts later bases', () => {
  let source =
    'let a=0; export function f(){ return 12; }\nfunction g(){return 2;} '
  let tree = emit('unit.ts', source)
  let selected = functionLiteral(tree)!
  equal(selected.function.node.kind, 'function_declaration')
  equal(
    containingFunction(tree, selected.literal)?.entity.eid,
    selected.function.entity.eid,
  )
  let changed = edit('unit.ts', source, tree, selected.literal)
  let before = pack(tree, source, 'declaration')
  let after = pack(changed.after, changed.changed, 'declaration')
  let last = before.at(-1)!
  let moved = after.find((p) => p.entity.eid == last.entity.eid)!
  equal(last.tree.value, moved.tree.value)
  equal(moved.tree.start, last.tree.start + 6)
  let old = new Map(before.map((p) => [p.entity.eid, p]))
  equal(
    after.filter((p) =>
      JSON.stringify(p.tree.value) !=
        JSON.stringify(old.get(p.entity.eid)?.tree.value)
    ).length,
    2,
  )
})

test('function fixture excludes the TypeScript number keyword', () => {
  let source = 'function typed(x: number): number { return 12; }'
  let tree = emit('typed.ts', source)
  let selected = functionLiteral(tree, source)!
  equal(
    new TextDecoder().decode(
      new TextEncoder().encode(source).slice(
        selected.literal.node.start,
        selected.literal.node.end,
      ),
    ),
    '12',
  )
  let changed = edit('typed.ts', source, tree, selected.literal)
  equal(changed.after.errors, tree.errors)
  equal(changed.after.nodes[0].node.kind, 'program')
})
