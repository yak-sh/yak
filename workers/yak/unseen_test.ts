/// <reference lib="deno.ns" />
// The pure seams of what an agent is told broke (unseen.ts): which word closes
// which break, which file a break happened in, and what the rider is quiet
// about. The end-to-end half — a page reporting itself, the mark landing in
// the app's store — is serving_test.ts and report_test.ts.
import { assert, assertEquals } from '@std/assert'
import { fileOf, named, past } from './unseen.ts'

let E = 'e0000000-0000-4000-8000-00000000000e'

// One open break, as `openIn` hands it back.
let broke = (
  e: { at?: string; version?: number | null; request?: string },
) => ({
  kind: 'exception',
  entity: { eid: E, num: 84 },
  exception: { message: 'boom', ...e },
})

// The words a caller may say, against a break on v2 at noon on the 14th.
let hit = broke({ at: '2026-08-14T12:00:00.000Z', version: 2 })

Deno.test('named: an id, either spelling', () => {
  assert(named('E-84', hit))
  assert(named(E, hit))
  assert(!named('E-85', hit))
  // A uuid is not a moment, and neither is a human id: the shapes cannot
  // collide, so a stale id is refused rather than closing the whole app.
  assert(!named('E-84-ish', hit))
})

Deno.test('named: a version bound is up to AND including', () => {
  assert(named('v2', hit))
  assert(named('v3', hit))
  assert(!named('v1', hit))
  // A break from before the counter goes with any version bound: nothing can
  // say whether it is still true.
  assert(named('v1', broke({ version: null })))
})

Deno.test('named: a day means the end of it, an instant itself', () => {
  assert(named('2026-08-14', hit))
  assert(named('2026-08-15', hit))
  assert(!named('2026-08-13', hit))
  assert(named('2026-08-14T12:00:00.000Z', hit))
  assert(!named('2026-08-14T11:59:59.000Z', hit))
  // No moment at all goes with any moment bound.
  assert(named('2026-01-01', broke({ version: 2 })))
})

Deno.test('named: all, and nothing else sweeping', () => {
  assert(named('all', hit))
  assert(!named('everything', hit))
  assert(!named('', hit))
})

Deno.test('fileOf: the app-relative path a break names', () => {
  let cases: [string, string][] = [
    ['page /recipes/app.js', 'app.js'],
    ['page /recipes/', 'index.html'],
    ['page /recipes', 'index.html'],
    ['page /recipes/deep/thing.css', 'deep/thing.css'],
    // An app serving the space's front page is asked for at the root.
    ['page /', 'index.html'],
    ['page /app.js', 'app.js'],
    // A network-error report from the browser wears its own type word.
    ['network-error /recipes/app.js', 'app.js'],
  ]
  for (let [request, want] of cases) {
    assertEquals(fileOf('recipes', request), want)
  }
})

Deno.test('fileOf: nothing, where a break names no path', () => {
  assertEquals(fileOf('recipes', ''), '')
  assertEquals(fileOf('recipes', 'worker threw'), '')
  assertEquals(fileOf('recipes', undefined), '')
})

Deno.test('past: what the rider is quiet about', () => {
  // News: it happened on what the app is serving now.
  assert(!past({ version: 2 }, hit))
  // A release replaced the code that made it.
  assert(past({ version: 3 }, hit))
  // An app that has never been deployed serves v0, and a break on v0 is news.
  assert(!past({ version: 0 }, broke({ version: 0 })))
  assert(!past({}, broke({ version: 0 })))
  // No version at all predates the counter.
  assert(past({ version: 1 }, broke({ version: null })))
})
