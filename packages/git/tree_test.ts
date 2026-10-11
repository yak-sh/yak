// Trees: git's order, git's bytes, git's ids — and the fold from a flat
// manifest into the nest they need. Constants: ./testing.ts.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { concat, oid, oid256 } from './oid.ts'
import { DIR, FILE, nest, sorted, treeBody, treeEntries } from './tree.ts'
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
} from './testing.ts'

let lib = [{ name: 'a.txt', mode: FILE, oid: X_OID }]
let root = [
  { name: 'hello.txt', mode: FILE, oid: HELLO_OID },
  { name: 'lib', mode: DIR, oid: LIB_OID },
]

test('a tree is named as git names it', async () => {
  assertEquals(await oid('tree', treeBody(lib)), LIB_OID)
  assertEquals(await oid('tree', treeBody(root)), ROOT_OID)
})

test('the SHA-256 tree names its children by their SHA-256 names', async () => {
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

test('a directory sorts as though its name ended in a slash', async () => {
  let entries = [
    { name: 'a', mode: DIR, oid: LIB_OID },
    { name: 'a.txt', mode: FILE, oid: HELLO_OID },
  ]
  // plain name order would put the directory first; git's does not
  assertEquals(sorted(entries).map((e) => e.name), ['a.txt', 'a'])
  assertEquals(await oid('tree', treeBody(entries)), SORT_OID)
  assertEquals(await oid('tree', treeBody([...entries].reverse())), SORT_OID)
})

test('the body spells a directory mode without its leading zero', () => {
  assertEquals(
    new TextDecoder().decode(treeBody(root).slice(0, 9)),
    '100644 he',
  )
  assertEquals(
    new TextDecoder().decode(treeBody([root[1]]).slice(0, 6)),
    '40000 ',
  )
})

test('tree children are read from both hash formats without decoding raw ids', () => {
  for (let width of [20, 32]) {
    let entries = [
      {
        name: 'a folder 🐂',
        mode: DIR,
        oid: '00ff20'.repeat(width).slice(0, width * 2),
      },
      {
        name: 'héllo.txt',
        mode: FILE,
        oid: 'ff0020'.repeat(width).slice(0, width * 2),
      },
    ]
    assertEquals(treeEntries(treeBody(entries), width), sorted(entries))
  }
  assertEquals(treeEntries(new Uint8Array()), [])
})

test('an incomplete or malformed tree entry is refused', () => {
  let text = new TextEncoder()
  let body = treeBody(root)
  for (
    let broken of [
      body.subarray(0, body.length - 1),
      text.encode('100644 missing terminator'),
      concat([text.encode('100644 \0'), new Uint8Array(20)]),
      concat([text.encode('blob name\0'), new Uint8Array(20)]),
      concat([
        text.encode('100644 '),
        new Uint8Array([255, 0]),
        new Uint8Array(20),
      ]),
    ]
  ) {
    assertThrows(() => treeEntries(broken), Error, 'malformed tree body')
  }
})

test('a manifest folds into directories', () => {
  let root = nest({ 'index.html': 'a', 'lib/a.js': 'b', '/lib/deep/c.js': 'c' })
  assertEquals([...root.files.keys()], ['index.html'])
  assertEquals([...root.dirs.keys()], ['lib'])
  let lib = root.dirs.get('lib')!
  assertEquals([...lib.files.keys()], ['a.js'])
  assertEquals([...lib.dirs.get('deep')!.files.keys()], ['c.js'])
})

test('a manifest that leaves its root, or forks a name, is refused', () => {
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
