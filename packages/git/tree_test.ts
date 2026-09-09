// Trees: git's order, git's bytes, git's ids — and the fold from a flat
// manifest into the nest they need. Constants: ./harness.ts.

import { assertEquals, assertThrows } from '@std/assert'
import { oid, oid256 } from './oid.ts'
import { DIR, FILE, nest, sorted, treeBody } from './tree.ts'
import {
  HELLO_OID,
  HELLO_OID256,
  LIB_OID,
  LIB_OID256,
  ROOT_OID,
  ROOT_OID256,
  SORT_OID,
  X_OID,
  X_OID256,
} from './harness.ts'

let lib = [{ name: 'a.txt', mode: FILE, oid: X_OID }]
let root = [
  { name: 'hello.txt', mode: FILE, oid: HELLO_OID },
  { name: 'lib', mode: DIR, oid: LIB_OID },
]

Deno.test('a tree is named as git names it', async () => {
  assertEquals(await oid('tree', treeBody(lib)), LIB_OID)
  assertEquals(await oid('tree', treeBody(root)), ROOT_OID)
})

Deno.test('the SHA-256 tree names its children by their SHA-256 names', async () => {
  assertEquals(
    await oid256('tree', treeBody([{ ...lib[0], oid: X_OID256 }])),
    LIB_OID256,
  )
  assertEquals(
    await oid256(
      'tree',
      treeBody([
        { name: 'hello.txt', mode: FILE, oid: HELLO_OID256 },
        { name: 'lib', mode: DIR, oid: LIB_OID256 },
      ]),
    ),
    ROOT_OID256,
  )
})

Deno.test('a directory sorts as though its name ended in a slash', async () => {
  let entries = [
    { name: 'a', mode: DIR, oid: LIB_OID },
    { name: 'a.txt', mode: FILE, oid: HELLO_OID },
  ]
  // plain name order would put the directory first; git's does not
  assertEquals(sorted(entries).map((e) => e.name), ['a.txt', 'a'])
  assertEquals(await oid('tree', treeBody(entries)), SORT_OID)
  assertEquals(await oid('tree', treeBody([...entries].reverse())), SORT_OID)
})

Deno.test('the body spells a directory mode without its leading zero', () => {
  assertEquals(
    new TextDecoder().decode(treeBody(root).slice(0, 9)),
    '100644 he',
  )
  assertEquals(
    new TextDecoder().decode(treeBody([root[1]]).slice(0, 6)),
    '40000 ',
  )
})

Deno.test('a manifest folds into directories', () => {
  let root = nest({ 'index.html': 'a', 'lib/a.js': 'b', '/lib/deep/c.js': 'c' })
  assertEquals([...root.files.keys()], ['index.html'])
  assertEquals([...root.dirs.keys()], ['lib'])
  let lib = root.dirs.get('lib')!
  assertEquals([...lib.files.keys()], ['a.js'])
  assertEquals([...lib.dirs.get('deep')!.files.keys()], ['c.js'])
})

Deno.test('a manifest that leaves its root, or forks a name, is refused', () => {
  assertThrows(() => nest({ '../escape': 'a' }), Error, 'leaves its own root')
  assertThrows(
    () => nest({ 'a': 'x', 'a/b': 'y' }),
    Error,
    'both a file and a directory',
  )
  assertThrows(
    () => nest({ 'a/b': 'y', 'a': 'x' }),
    Error,
    'both a file and a directory',
  )
})
