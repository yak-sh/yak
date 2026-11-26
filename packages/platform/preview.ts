/**
 * `@yaks/platform/preview` — a draft's private preview link, as rules a host
 * serves it by. A link is a short random code mounted under its app,
 * `/<app>/~<code>/…`, naming a stored, revocable `preview_link` row, or, made
 * before those, a sealed ticket at `/<app>/_preview/<ticket>/…`; either
 * reads as a {@link Ticket}. It shows one of the app's drafts as it
 * stands at each request, or once a release takes the draft, what was
 * released. Each state of the draft is served as a release of its own, named
 * for the files it holds, so whichever process built it, the next request
 * finds it.
 *
 * Its host does the reading and the building: yaks.app reads the link,
 * reads the directory and the draft's rows, keeps each state in R2 and runs a
 * state's worker in its dispatch namespace (workers/yak preview.ts). This
 * module says what those readings make: where a link is mounted (`mountOf`,
 * `aimed`), a stored link's code and address (`codeOf`, `linkMount`), whom
 * a ticket still admits, until when and as whom (`admits`,
 * `until`, `reading`, `viewer`), which
 * draft and link it shows (`shows`, `linkFor`), which of the link's doors a
 * request goes to (`door`), where a state is kept and what building it sets
 * up again (`stateOf`, `starting`, `resets`, `seeding`, `outside`), the states
 * a draft passed through (`undone`), and the headers every answer wears
 * (`PRIVATE`).
 *
 * ```ts
 * import { aimed, door } from '@yaks/platform/preview'
 * import { assertEquals } from '@std/assert'
 * let at = aimed('/cookbook/_preview/t/api/apply')!
 * assertEquals(at.mount, '/cookbook/_preview/t/')
 * assertEquals(
 *   door({ path: at.path, method: 'POST', reads: true, waiting: false }),
 *   { to: 'nothing', status: 403 },
 * )
 * ```
 *
 * @module
 */
import { DOORS as STORE } from '@yaks/api'
import { type Level, writes } from '@yaks/member'
import { derivedEid } from '@yaks/graph/identity'
import { decoded, inside, seedy } from './files.ts'
import { type Host, spaceHost } from './host.ts'
import { VOCABS } from './manifest.ts'
import { PREVIEW } from './routes.ts'
import { BUILT, type Files } from './versions.ts'

/** Where a link's pages are mounted: under its app, at its ticket. */
/// mountOf('cookbook', 't') -> '/cookbook/_preview/t/'
export let mountOf = (app: string, ticket: string): string =>
  `/${app}/${PREVIEW}/${ticket}/`

/** How many characters a link's code has: from {@link ALPHABET}, about 62
 * bits, so nobody finds a link by guessing. */
export let CODE = 12
let ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A link's code from `random` bytes, one character a byte. */
/// codeOf(new Uint8Array(12)) -> 'aaaaaaaaaaaa'
/// codeOf(new Uint8Array([1, 37, 255, 3, 4, 5, 6, 7, 8, 9, 10, 11])) -> 'bbddefghijkl'
export let codeOf = (random: Uint8Array): string =>
  [...random.slice(0, CODE)].map((b) => ALPHABET[b % ALPHABET.length]).join('')

/** Where a stored link's pages are mounted: under its app, at its code. */
/// linkMount('cookbook', 'k3f9x2ab7q1z') -> '/cookbook/~k3f9x2ab7q1z/'
export let linkMount = (app: string, code: string): string =>
  `/${app}/~${code}/`

/** A link's address as a request names it: its app's slug, the credential
 * it carries (a sealed ticket, or a stored link's `code`), where it is
 * mounted, and the path under that from the app's root. */
export type Aimed = {
  app: string
  ticket?: string
  code?: string
  mount: string
  path: string
}

let ADDRESS = new RegExp(`^/([^/]+)/${PREVIEW}/([^/]+)/(.*)$`)
let CODED = new RegExp(`^/([^/]+)/~([a-z0-9]{${CODE}})(?:/(.*))?$`)

/** The link `pathname` is under, or null where it names none. */
/// aimed('/cookbook/_preview/t/about/') -> { app: 'cookbook', ticket: 't', mount: '/cookbook/_preview/t/', path: '/about/' }
/// aimed('/cookbook/_preview/t/') -> { app: 'cookbook', ticket: 't', mount: '/cookbook/_preview/t/', path: '/' }
/// aimed('/cookbook/~k3f9x2ab7q1z/about/') -> { app: 'cookbook', code: 'k3f9x2ab7q1z', mount: '/cookbook/~k3f9x2ab7q1z/', path: '/about/' }
/// aimed('/cookbook/~k3f9x2ab7q1z') -> { app: 'cookbook', code: 'k3f9x2ab7q1z', mount: '/cookbook/~k3f9x2ab7q1z/', path: '/' }
/// aimed('/cookbook/_preview/t') -> null
/// aimed('/cookbook/~abc.def/') -> null
/// aimed('/cookbook/about') -> null
export let aimed = (pathname: string): Aimed | null => {
  let m = ADDRESS.exec(pathname)
  if (m) {
    return {
      app: m[1],
      ticket: m[2],
      mount: mountOf(m[1], m[2]),
      path: `/${m[3]}`,
    }
  }
  let c = CODED.exec(pathname)
  return c &&
    {
      app: c[1],
      code: c[2],
      mount: linkMount(c[1], c[2]),
      path: `/${c[3] ?? ''}`,
    }
}

/** The page `value` names within an app, as a link's address ends: its path,
 * query and hash from the app's root, without the leading slash; null where it
 * leaves the app or names a preview of its own. */
/// within('/about/?tab=2#top') -> 'about/?tab=2#top'
/// within(null) -> ''
/// within('https://elsewhere.example/') -> null
/// within('a/_preview/t/') -> null
export let within = (value: unknown): string | null => {
  let path = value == null ? '' : String(value).replace(/^\/+/, '')
  let parsed = new URL(path, 'https://preview.invalid/')
  if (
    parsed.origin != 'https://preview.invalid' ||
    parsed.pathname.includes(`/${PREVIEW}/`)
  ) return null
  return parsed.pathname.slice(1) + parsed.search + parsed.hash
}

/** What a link's ticket names: the draft it shows (`of`), or else the
 * `version` of its app, as whom, and the unix second it stops opening at
 * (`exp`). A ticket for a paired TV names its `screen`: it reads the draft as
 * a viewer, and only while that screen stays paired with the person. */
export type Ticket = {
  app: string
  space: string
  person: string
  of: string
  version?: number
  exp: number
  screen?: string
}

/** How long a link opens for at least, in seconds. */
export let LASTS = 12 * 3600

/** The `exp` a ticket sealed at `now` (milliseconds) carries: the end of the
 * window after the one `now` falls in, so a link lasts from {@link LASTS} to
 * twice that, and one sealed again within a window is the same link, which
 * a TV following it does not reload for. */
/// until(0) -> 86400
/// until(43199999) -> 86400
/// until(43200000) -> 129600
export let until = (now: number): number =>
  (Math.floor(now / 1000 / LASTS) + 2) * LASTS

/** A draft as a link reads it: its id, and the author holding it, none for
 * the draft from before each draft had an author. */
export type Drafting = { eid: string; by: string | null }

/** An app as a link reads it: its slug, the link it had before each draft had
 * its own (`followed`), and whether it is in the trash. */
export type Linked = {
  slug: string
  followed?: string | null
  trashed?: unknown
}

/** The link a draft's preview serves from and is told at: its own eid, or
 * for the draft no author holds, the app's link from before each draft had
 * its own (`followed`), where that draft's states are already kept. */
/// linkFor({ slug: 'a', followed: 'old' }, { eid: 'd', by: null }) -> 'old'
/// linkFor({ slug: 'a', followed: 'old' }, { eid: 'd', by: 'p' }) -> 'd'
export let linkFor = (app: Linked, d: Drafting): string =>
  !d.by && app.followed ? app.followed : d.eid

/** The draft a ticket shows among the app's: the one it names; null once
 * that draft is closed, when the link shows what was released, read-only, as
 * a link to one version of the app always does. */
export let shows = <D extends Drafting>(t: Ticket, drafts: D[]): D | null =>
  drafts.find((d) => d.eid == t.of) ?? null

/** What the directory holds of a ticket's space and app now, and the level
 * its person holds there. */
export type Holding = {
  space: { eid: string; slug: string; trashed?: unknown }
  app: Linked
  role: Level | null
}

/** Whether a ticket still opens its link, asked at `host` for the app `app`
 * names at `now` (milliseconds): it has not expired, its app is where it was,
 * in the space it was sealed for, out of the trash, and its person still
 * writes there. A TV's holds while its screen is still paired with the person
 * (`paired`, whom it is paired with). A ticket sealed before tickets expired
 * carries no `exp`, and opens nothing. */
export let admits = (
  t: Ticket,
  { space, app, role }: Holding,
  at: { host: string; app: string; now: number; paired?: string | null },
  env: Host = {},
): boolean =>
  typeof t.of == 'string' && typeof t.exp == 'number' &&
  t.exp * 1000 > at.now &&
  (!t.screen || at.paired == t.person) &&
  space.eid == t.space &&
  at.host == spaceHost(env, space.slug) &&
  app.slug == at.app &&
  !app.trashed && !space.trashed && writes(role)

/** Whether a link only reads: a TV's always, and anyone's once its draft is
 * closed (`open` false), when it shows the release over the live rows. */
/// reading({ app: 'a', space: 's', person: 'p', of: 'd', exp: 1 }, true) -> false
/// reading({ app: 'a', space: 's', person: 'p', of: 'd', exp: 1 }, false) -> true
/// reading({ app: 'a', space: 's', person: 'p', of: 'd', exp: 1, screen: 'tv' }, true) -> true
export let reading = (t: Ticket, open: boolean): boolean => !!t.screen || !open

/** Who a link's request is: a TV reads as a viewer; the app's own worker
 * coming back through its `grant` is who it carries, at the ticket person's
 * level where it carries them; anyone else is the ticket's person, at the
 * level they hold. A link that only reads (`reading`) holds no more than a
 * viewer's level, so nothing it reaches writes the live rows. */
export let viewer = <G extends { person: string | null; role: Level | null }>(
  t: Ticket,
  role: Level,
  grant: G | null,
  open: boolean,
): G | { person: string; role: Level; via: string } => {
  let level: Level = reading(t, open) ? 'viewer' : role
  return t.screen
    ? { person: t.person, role: 'viewer', via: t.screen }
    : grant
    ? { ...grant, role: grant.person == t.person ? level : grant.role }
    : { person: t.person, role: level, via: t.app }
}

/** The store doors a link's pages reach, from the app's `/api`: every door
 * @yaks/api answers, so a page's client finds each one it asks (`me()` asks
 * `/who`), and the platform's own beside them. */
export let DOORS: string[] = [
  ...STORE,
  '/client.js',
  '/storage.js',
  '/storage',
  '/_draft.js',
  '/_outbox.js',
  '/_wire.js',
  '/me',
  '/graph',
  '/vocab.json',
]

/** Which of a link's doors a request goes to. */
export type Door =
  /** nothing, with `status` */
  | { to: 'nothing'; status: 403 | 404 | 503 }
  /** one of the store doors, `door` from its `/api` */
  | { to: 'api'; door: string }
  /** the app's page, its worker first and its files behind, `file` the path
   * decoded */
  | { to: 'page'; file: string }

/** Which door `path`, from the app's root, goes to. An open draft's pages
 * read and write its branch alone, never the live rows, so until it has one
 * (`waiting`) its store doors wait. A link that only `reads` (a TV's, or one
 * whose draft is closed): its page's writes are refused, and what the page
 * keeps for the person stays in the page. */
/// door({ path: '/api/query', method: 'GET', reads: false, waiting: false }) -> { to: 'api', door: '/query' }
/// door({ path: '/api/who', method: 'GET', reads: true, waiting: false }) -> { to: 'api', door: '/who' }
/// door({ path: '/api/query', method: 'GET', reads: false, waiting: true }) -> { to: 'nothing', status: 503 }
/// door({ path: '/api/blob', method: 'GET', reads: false, waiting: false }) -> { to: 'nothing', status: 404 }
/// door({ path: '/api/storage', method: 'PUT', reads: true, waiting: false }) -> { to: 'nothing', status: 403 }
/// door({ path: '/a%20b.css', method: 'GET', reads: false, waiting: false }) -> { to: 'page', file: '/a b.css' }
/// door({ path: '/vocab.json', method: 'GET', reads: false, waiting: false }) -> { to: 'nothing', status: 404 }
export let door = (
  { path, method, reads, waiting }: {
    path: string
    method: string
    reads: boolean
    waiting: boolean
  },
): Door => {
  if (path.startsWith('/api/')) {
    if (waiting) return { to: 'nothing', status: 503 }
    let at = path.slice(4)
    if (!DOORS.includes(at)) return { to: 'nothing', status: 404 }
    if (reads && (at == '/apply' || (at == '/storage' && method != 'GET'))) {
      return { to: 'nothing', status: 403 }
    }
    return { to: 'api', door: at }
  }
  let file = decoded(path)
  return file && !inside(file)
    ? { to: 'page', file }
    : { to: 'nothing', status: 404 }
}

/** What every answer of a link wears: nobody keeps it, no page it links to
 * is told where it came from, and no search engine reads it. */
export let PRIVATE = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
}

/** Where one state of a draft is kept, in the store `store` keeps releases
 * under: a release of `app` named for the link and the files it holds. */
export let stateOf = (
  store: string,
  app: string,
  link: string,
  files: Files,
): string =>
  `${store}/.releases/${app}/${
    derivedEid(
      `preview|${link}|${JSON.stringify(Object.entries(files).sort())}`,
    )
  }`

/** The worker a link's states run in, where one has a worker. */
/// scriptOf('a1', 'd1') -> 'app-a1-preview-d1'
export let scriptOf = (app: string, link: string): string =>
  `app-${app}-preview-${link}`

/** What a built state says of itself, at {@link RECORD} beside its index:
 * the digest of the worker it uploaded, null where it has none. */
export type Built = { worker: string | null }
export let RECORD = `${BUILT}.preview.json`

/** The files a state is built from: the draft's, with what the state before
 * it compiled carried over, so a page script is compiled once per sha. */
/// starting({ 'a.js': '1' }, { 'a.js': '0', 'esbuild/x': '9', [RECORD]: '8' }) -> { 'a.js': '1', 'esbuild/x': '9', [RECORD]: '8' }
/// starting({ 'a.js': '1' }, null) -> { 'a.js': '1' }
export let starting = (files: Files, before: Files | null): Files => ({
  ...files,
  ...Object.fromEntries(
    Object.entries(before ?? {}).filter(([path]) => path.startsWith(BUILT)),
  ),
})

// The files whose change sets the store's words up again.
let WORDS = [...VOCABS, 'package.json']

/** Whether a state's store is given its words again: the first state, and
 * any whose declaration or package.json differs from the state before. */
/// resets({ 'vocab.json': '1' }, { 'vocab.json': '1', 'a.js': '0' }) -> false
/// resets({ 'vocab.json': '2' }, { 'vocab.json': '1' }) -> true
/// resets({}, null) -> true
export let resets = (files: Files, before: Files | null): boolean =>
  !before || WORDS.some((path) => before[path] != files[path])

/** The seed files a state's store takes rows from: those the state before
 * did not hold as they are. */
/// seeding({ 'seed.json': '2', 'seed/a.yml': '1', 'a.js': '3' }, { 'seed/a.yml': '1' }) -> ['seed.json']
export let seeding = (files: Files, before: Files | null): string[] =>
  Object.keys(files).filter((path) =>
    seedy(path) && (!before || before[path] != files[path])
  )

/** The bindings a preview never runs with: the live app's own D1, R2,
 * Vectorize and Durable Objects. App-owned resources take a release; the
 * graph store is the preview's own. */
export let OUTSIDE = [
  'd1_databases',
  'r2_buckets',
  'vectorize',
  'durable_objects',
  'migrations',
] as const

/** Which of {@link OUTSIDE} a draft's wrangler config binds. */
/// outside({ r2_buckets: [], vars: {} }) -> ['r2_buckets']
/// outside({}) -> []
export let outside = (config: Record<string, unknown>): string[] =>
  OUTSIDE.filter((name) => config[name] != null)

/** A write of a draft as undoing it reads: when, to which path, and the sha
 * it replaced, none where it made the file. */
export type Undo = { at: string | null; path: string; was: string | null }

/** The files of each state a draft passed through, newest first: `files` as
 * they stand, then as they were before each moment of `rows` (newest first),
 * down to what the draft began from. The writes of one moment are undone
 * together. */
/// [...undone({ a: '2', b: '1' }, [{ at: 't2', path: 'a', was: '1' }, { at: 't1', path: 'b', was: null }])] -> [{ a: '2', b: '1' }, { a: '1', b: '1' }, { a: '1' }]
export function* undone(files: Files, rows: Undo[]): Generator<Files> {
  let now = { ...files }
  let left = [...rows]
  yield { ...now }
  while (left.length) {
    let at = left[0].at
    while (left.length && left[0].at == at) {
      let row = left.shift()!
      if (row.was) now[row.path] = row.was
      else delete now[row.path]
    }
    yield { ...now }
  }
}

/** `files` each named with the compiled page entries that import it, by
 * `pages` (entry to the paths it was built from); a file no entry imports is
 * left as it is. */
/// entered([{ path: 'a.js' }, { path: 'b.css' }], { 'index.html': ['a.js'] }) -> [{ path: 'a.js', entries: ['index.html'] }, { path: 'b.css' }]
export let entered = <F extends { path: string }>(
  files: F[],
  pages: Record<string, string[]>,
): (F & { entries?: string[] })[] =>
  files.map((file) => {
    let entries = Object.entries(pages).filter(([, paths]) =>
      paths.includes(file.path)
    ).map(([entry]) => entry)
    return entries.length ? { ...file, entries } : file
  })
