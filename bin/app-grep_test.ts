// bin/app-grep's pure seams: which keys are an app's files, which copies a
// run gets and removes, and how a match reads. The bucket and rg are the
// tool's own business.
import { assertEquals } from '@std/assert'
import { gone, isFile, shown, stale } from './app-grep.ts'

let sha = 'a'.repeat(64)

Deno.test('isFile: an app file, never an upload or the platform bytes', () => {
  let cases: [string, boolean][] = [
    ['yourname/recipes/index.html', true],
    ['yourname/recipes/lib/app.js', true],
    ['yourname/recipes/blobs/notes.js', true],
    [`yourname/recipes/blobs/${sha}`, false],
    [`sha/${sha}`, false],
    [`git/${sha}`, false],
    ['yourname/recipes/../x', false],
    ['yourname//index.html', false],
  ]
  for (let [key, want] of cases) assertEquals(isFile(key), want, key)
})

Deno.test('stale and gone: a run gets what moved and removes what left', () => {
  let objs = [
    { key: 'a/b/same', etag: '1' },
    { key: 'a/b/moved', etag: '3' },
    { key: 'a/b/new', etag: '4' },
  ]
  let had = { 'a/b/same': '1', 'a/b/moved': '2', 'a/b/left': '5' }
  assertEquals(stale(objs, had).map((o) => o.key), ['a/b/moved', 'a/b/new'])
  assertEquals(gone(objs, had), ['a/b/left'])
})

Deno.test('shown: a match reads path:line: text', () => {
  assertEquals(shown('a/b/x.js\x002\x00let c: 1'), 'a/b/x.js:2: let c: 1')
  assertEquals(shown('a/b/x.js\x002\x007\x00text'), 'a/b/x.js:2:7: text')
  assertEquals(shown('a/b/x.js:3'), 'a/b/x.js:3')
})
