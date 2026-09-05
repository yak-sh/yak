// The home app as the space's ROUTER (D-34197): which paths its worker sees
// FIRST, before the app whose slug owns them. `router{first}` is the app's own
// facet — a list of path globs, the way Workers static assets' `run_worker_first`
// takes globs — and this file is the whole rule that column is written and read
// by: what a glob may say, what it may never name, and whether one answers a
// given path.
//
// Empty is the ordinary state and the default: a home app is plain files like
// any other app, and `first` is the deliberate opt-in.
//
// One `covers` for both doors. The refusal an owner reads is written in the
// same matcher the kernel will route with (T-34201), so the sentence they were
// told and the request that arrives cannot drift apart. Pure — no env, no
// store, no directory — so it is the same rule in a test, in `app_set`, and in
// the router.

// Everything between the wildcards, as itself: a glob's own `.` is a dot and
// not the regex's any-character.
let literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/// covers('/recipes/*', '/recipes/lemon') -> true
/// covers('/recipes/*', '/garden') -> false
/// covers('/*/print', '/recipes/lemon/print') -> true
/// covers('/recipes', '/recipes/lemon') -> false
/** Does this glob answer that path? `*` is any run of characters, slashes
 * included — one wildcard, no second spelling to learn. */
export let covers = (glob: string, path: string): boolean =>
  new RegExp(`^${glob.split('*').map(literal).join('.*')}$`).test(path)

/**
 * The paths the kernel answers itself, which no app routes (D-34197 rung 1).
 * `/api/*` is here beside `/<app>/api/*` because the home app is served at the
 * bare hostname, where its own store door is `/api/…` with no slug in front of
 * it (apps.ts `served`) — one door, two spellings of its address.
 */
export let PLATFORM_PATHS = [
  '/login',
  '/login/*',
  '/connect',
  '/deploy',
  '/mcp',
  '/api/*',
  '/*/api/*',
]

// A glob's WITNESS: the pattern with its wildcards filled by a character no
// path may hold, so only another wildcard can match it. Two globs overlap when
// either answers the other's witness — which catches both directions with one
// matcher, `/*` naming `/login` and `/*/api/query` naming the store doors
// alike, and leaves `/recipes/*` alone, since a glob that merely CONTAINS a
// platform path still loses to it at the door.
let MARK = '\u0000'
let overlaps = (a: string, b: string) =>
  covers(a, b.replaceAll('*', MARK)) || covers(b, a.replaceAll('*', MARK))

// A path and nothing else: RFC 3986's path characters, `/`, and the wildcard.
let PATH = /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*$/

let SHAPE = 'a list of path globs, like ["/recipes/*"]'

/// globs(null, []) -> []
/// globs(['/recipes/*', '/*/print'], []) -> ['/recipes/*', '/*/print']
/// globs('/recipes/*', []) throws 'first is a list of path globs'
/// globs(['recipes'], []) throws 'does not start with /'
/// globs(['/re cipes'], []) throws 'is not a path'
/// globs(['/login'], []) throws '/login names /login'
/// globs(['/*'], []) throws '/* names /login'
/// globs(['/*/api/*'], []) throws '/*/api/* names /*/api/*'
/// globs(['/platform/*'], ['platform']) throws '/platform/* names /platform/*'
/**
 * `router.first` as it arrives from an agent — a list of path globs — checked
 * and handed back. Every refusal names the glob and the rule, because the agent
 * reading it has no other source; `kernels` is the slugs the platform keeps for
 * itself (directory.ts `META`), which are nobody's to route.
 */
export let globs = (first: unknown, kernels: string[]): string[] => {
  if (first == null) return []
  if (!Array.isArray(first)) throw new Error(`first is ${SHAPE}`)
  let owned = [
    ...PLATFORM_PATHS,
    ...kernels.flatMap((k) => [`/${k}`, `/${k}/*`]),
  ]
  return first.map((glob) => {
    if (typeof glob != 'string' || !glob) {
      throw new Error(`${JSON.stringify(glob)} is not a path glob — ${SHAPE}`)
    }
    if (!glob.startsWith('/')) {
      throw new Error(`${glob} does not start with / — a glob is a path`)
    }
    if (!PATH.test(glob)) {
      throw new Error(`${glob} is not a path — path characters and * only`)
    }
    let taken = owned.find((p) => overlaps(glob, p))
    if (taken) {
      throw new Error(
        `${glob} names ${taken}, which the platform answers itself — route ` +
          "a path of the app's own",
      )
    }
    return glob
  })
}

/// firstOf({first: '["/recipes/*"]'}) -> ['/recipes/*']
/// firstOf(undefined) -> []
/// firstOf({first: 'not json'}) -> []
/**
 * The column as the App row reads it (directory.ts `appOf`): the JSON array in
 * `router.first`, or nothing at all. Lenient where {@link globs} is strict — a
 * read must answer whatever the row holds, since the graph tier writes this
 * column too, and a listing must not fall over on one somebody typed by hand.
 */
export let firstOf = (router?: { first?: string | null } | null): string[] => {
  try {
    let held = JSON.parse(router?.first || '[]')
    return Array.isArray(held) ? held.filter((g) => typeof g == 'string') : []
  } catch {
    return []
  }
}
