/// <reference lib="deno.ns" />
// The `///` doctests in router.ts, run — this repo has no doctest runner
// (src/fp_test.ts, same shape) — plus the refusals a person actually reads,
// asserted whole rather than by their first clause.
//
// The rule under test is D-34197's rung 1: the home app opts in to routing with
// globs, and the platform's own paths are nobody's.
import { assertEquals, assertThrows } from '@std/assert'
import { covers, firstOf, globs } from './router.ts'

// The kernel's own slug, the way app_set passes it (directory.ts META).
let KERNELS = ['platform']

Deno.test('covers: a glob answers a path, wildcards crossing slashes', () => {
  assertEquals(covers('/recipes/*', '/recipes/lemon'), true)
  assertEquals(covers('/recipes/*', '/garden'), false)
  assertEquals(covers('/*/print', '/recipes/lemon/print'), true)
  // A prefix is not a glob: `/recipes` answers `/recipes` and nothing under it.
  assertEquals(covers('/recipes', '/recipes/lemon'), false)
  // The `.` is a literal, not the regex's own wildcard.
  assertEquals(covers('/logo.png', '/logoxpng'), false)
})

Deno.test('globs: a list of path globs, handed back', () => {
  assertEquals(globs(null, KERNELS), [])
  assertEquals(globs([], KERNELS), [])
  assertEquals(globs(['/recipes/*', '/*/print'], KERNELS), [
    '/recipes/*',
    '/*/print',
  ])
})

// Each refusal names the glob AND the rule, because the agent reading it has
// no other source (vocab.ts TEACH, same reason).
Deno.test('globs: refuses what is not a path glob', () => {
  assertEquals(
    assertThrows(() => globs('/recipes/*', KERNELS), Error).message,
    'first is a list of path globs, like ["/recipes/*"]',
  )
  assertEquals(
    assertThrows(() => globs([7], KERNELS), Error).message,
    '7 is not a path glob — a list of path globs, like ["/recipes/*"]',
  )
  assertEquals(
    assertThrows(() => globs(['recipes'], KERNELS), Error).message,
    'recipes does not start with / — a glob is a path',
  )
  assertEquals(
    assertThrows(() => globs(['/re cipes'], KERNELS), Error).message,
    '/re cipes is not a path — path characters and * only',
  )
})

// The platform's own paths, from both directions: a glob that NAMES one, and a
// glob wide enough to swallow one.
Deno.test('globs: refuses a glob that names a platform path', () => {
  let refused = (glob: string) =>
    assertThrows(() => globs([glob], KERNELS), Error).message
  assertEquals(
    refused('/login'),
    '/login names /login, which the platform answers itself — route a path ' +
      "of the app's own",
  )
  assertEquals(refused('/login/*').startsWith('/login/* names /login/*'), true)
  assertEquals(refused('/connect').startsWith('/connect names /connect'), true)
  assertEquals(refused('/mcp').startsWith('/mcp names /mcp'), true)
  // The store doors, in both spellings: the home app's own at the bare
  // hostname, and every app's under its slug.
  assertEquals(refused('/api/*').startsWith('/api/* names /api/*'), true)
  assertEquals(
    refused('/*/api/*').startsWith('/*/api/* names /*/api/*'),
    true,
  )
  // A glob aimed straight at one door of that family is the same refusal.
  assertEquals(
    refused('/*/api/query').startsWith('/*/api/query names /*/api/*'),
    true,
  )
  // Wide enough to swallow one: `/*` is every path there is.
  assertEquals(refused('/*').startsWith('/* names /login'), true)
  // The kernel's own slug is nobody's to route.
  assertEquals(
    refused('/platform/*').startsWith('/platform/* names /platform/*'),
    true,
  )
})

// A glob that merely CONTAINS a platform path is fine: the kernel answers rung
// 1 before it ever consults the home app, so `/recipes/*` never sees
// `/recipes/api/query`.
Deno.test('globs: a glob under an app is not a platform path', () => {
  assertEquals(globs(['/recipes/*'], KERNELS), ['/recipes/*'])
  assertEquals(globs(['/logins'], KERNELS), ['/logins'])
  assertEquals(globs(['/platforms/*'], KERNELS), ['/platforms/*'])
})

// The read is lenient where the write is strict: the graph tier writes this
// column too, and a listing must not fall over on a row somebody typed.
Deno.test('firstOf: the column as the App row reads it', () => {
  assertEquals(firstOf({ first: '["/recipes/*"]' }), ['/recipes/*'])
  assertEquals(firstOf(undefined), [])
  assertEquals(firstOf(null), [])
  assertEquals(firstOf({ first: null }), [])
  assertEquals(firstOf({ first: 'not json' }), [])
  assertEquals(firstOf({ first: '{"a": 1}' }), [])
  assertEquals(firstOf({ first: '["/a", 7]' }), ['/a'])
})
