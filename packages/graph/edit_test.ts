import { assertEquals, assertThrows } from '@std/assert'
import {
  type Bundle,
  type EditHost,
  patchText,
  resolveEdits,
  token,
} from './mod.ts'

let edit = (old: string, fresh: string) => ({ $edit: { old, new: fresh } })
let host: EditHost = {
  component: () => ({ body: 'stored', title: 'title' }),
  known: (name) => name == 'doc',
  text: (name, col) => name == 'doc' && ['body', 'title'].includes(col),
  name: () => 'D-1',
}
let bundle = (doc: Bundle['doc']): Bundle => ({ entity: { eid: 'd' }, doc })

Deno.test('edits: literals and repeated edits compose, guards name FOUND', () => {
  let input = [
    bundle({ body: 'literal' }),
    bundle({ body: edit('literal', 'first') }),
    bundle({ body: edit('first', 'second') }),
  ]
  let before = structuredClone(input)
  let out = resolveEdits(input, host)
  assertEquals(out.map((b) => b.doc), [
    { body: 'literal' },
    { body: 'first' },
    { body: 'second' },
  ])
  assertEquals(out.slice(1).map((b) => b.$was), [
    { doc: { body: token('stored') } },
    { doc: { body: token('stored') } },
  ])
  assertEquals(input, before)
  let explicit = {
    ...bundle({ body: edit('stored', 'new') }),
    $was: { doc: { body: null } },
  }
  assertEquals(resolveEdits([explicit], host)[0].$was, explicit.$was)
})

Deno.test('edits: explicit drops discard pending text; null is not absent', () => {
  for (let drop of [bundle(null), { entity: { eid: 'd' }, $delete: true }]) {
    let out = resolveEdits([
      bundle({ body: 'pending' }),
      drop,
      bundle({ body: edit('stored', 'fresh') }),
    ], host)
    assertEquals(out[2].doc, { body: 'fresh' })
  }
  assertThrows(
    () =>
      resolveEdits([
        bundle({ body: null }),
        bundle({ body: edit('stored', 'fresh') }),
      ], host),
    Error,
    '$edit: D-1.doc.body has no text value to edit',
  )
})

Deno.test('edits: operators and hunk refusals retain addressed messages', () => {
  for (let col of ['number', 'enum', 'ref', 'bool', 'unknown']) {
    assertThrows(
      () => resolveEdits([bundle({ [col]: edit('x', 'y') })], host),
      Error,
      `$edit: D-1.doc.${col} is not a wire-writable text column`,
    )
  }
  assertThrows(
    () => resolveEdits([bundle({ body: { $edt: {} } })], host),
    Error,
    'D-1.doc.body: unknown operator "$edt"',
  )
  assertThrows(
    () => resolveEdits([bundle({ body: edit('missing', 'x') })], host),
    Error,
    'edit: not found in D-1.doc.body: "missing"',
  )
  assertThrows(
    () => patchText('aa aa', [{ old: 'aa', new: 'x' }], 'D-1.doc.body'),
    Error,
    'edit: 2 matches in D-1.doc.body — pass replace_all/all',
  )
  assertEquals(
    patchText('aa aa', [{ old: 'aa', new: 'x', all: true }], 'body'),
    'x x',
  )
  assertThrows(
    () => patchText('aa', [{ old: 'aa', new: 'aa' }], 'body'),
    Error,
    'edit: the replacement leaves the value unchanged',
  )
  assertThrows(
    () => patchText('aa', [{ old: '', new: 'x' }], 'body'),
    Error,
    'edit: the text to replace is empty',
  )
  assertThrows(
    () =>
      resolveEdits([bundle({ body: { $edit: { old: 1, new: 'x' } } })], host),
    Error,
    '$edit: old and new must both be text',
  )
})
