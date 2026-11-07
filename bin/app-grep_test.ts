// bin/app-grep's pure seams: what a run lists, which copies it gets, and how
// a match reads. The bucket and rg are the
// tool's own business.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { isKept, isPlace, prefixes, shown, stale } from './app-grep.ts'

let sha = 'a'.repeat(64)

test('prefixes: the kept bytes and what each space indexes, never the platform', () => {
  let top = ['.rosters/', '__packages/', 'git/', 'jeff/', 'sha/', 'yourname/']
  let want = [
    ...[...'0123456789abcdef'].map((h) => `sha/${h}`),
    'jeff/.releases/',
    'jeff/.declarations/',
    'yourname/.releases/',
    'yourname/.declarations/',
  ]
  assertEquals(prefixes(top), want)
})

test('isPlace: a key the mirror can hold below itself', () => {
  let cases: [string, boolean][] = [
    ['jeff/.releases/eid/r.json', true],
    ['jeff/.releases/../x', false],
    ['jeff/.releases//x', false],
    ['jeff/.releases/./x', false],
  ]
  for (let [key, want] of cases) assertEquals(isPlace(key), want, key)
})

test('isKept: the bytes a kept version names, and nothing else', () => {
  let cases: [string, boolean][] = [
    [`sha/${sha}`, true],
    [`git/${sha}`, false],
    [`sha/${sha}/x`, false],
    ['sha/recipes/index.html', false],
  ]
  for (let [key, want] of cases) assertEquals(isKept(key), want, key)
})

test('stale: a run gets what moved, and a kept key only when no copy is held', () => {
  let objs = [
    { key: 'a/b/same', etag: '1' },
    { key: 'a/b/moved', etag: '3' },
    { key: 'a/b/new', etag: '4' },
    { key: `sha/${sha}`, etag: '5' },
    { key: `sha/${'b'.repeat(64)}`, etag: '6' },
  ]
  let had = { 'a/b/same': '1', 'a/b/moved': '2' }
  let held = new Set(['a/b/same', 'a/b/moved', `sha/${sha}`])
  assertEquals(stale(objs, had, held).map((o) => o.key), [
    'a/b/moved',
    'a/b/new',
    `sha/${'b'.repeat(64)}`,
  ])
})

test('shown: a match reads path:line: text', () => {
  assertEquals(shown('a/b/x.js\x002\x00let c: 1'), 'a/b/x.js:2: let c: 1')
  assertEquals(shown('a/b/x.js\x002\x007\x00text'), 'a/b/x.js:2:7: text')
  assertEquals(shown('a/b/x.js:3'), 'a/b/x.js:3')
})
