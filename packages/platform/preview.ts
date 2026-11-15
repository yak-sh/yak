/**
 * `@yaks/platform/preview` — a draft's private preview link, as rules a host
 * serves it by. A link is a sealed ticket mounted under its app,
 * `/<app>/_preview/<ticket>/…`, and shows one of the app's drafts as it
 * stands at each request, or once a release takes the draft, what was
 * released. Each state of the draft is served as a release of its own, named
 * for the files it holds, so whichever process built it, the next request
 * finds it.
 *
 * Its host does the reading and the building: yaks.app opens the ticket,
 * reads the directory and the draft's rows, keeps each state in R2 and runs a
 * state's worker in its dispatch namespace (workers/yak preview.ts). This
 * module says what those readings make: where a link is mounted (`mountOf`,
 * `aimed`), whom a ticket still admits and as whom (`admits`, `viewer`), which
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
 *   door({ path: at.path, method: 'POST', screen: true, waiting: false }),
 *   { to: 'nothing', status: 403 },
 * )
 * ```
 *
 * @module
 */
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

/** A link's address as a request names it: its app's slug, its ticket, where
 * it is mounted, and the path under that from the app's root. */
export type Aimed = { app: string; ticket: string; mount: string; path: string }

let ADDRESS = new RegExp(`^/([^/]+)/${PREVIEW}/([^/]+)/(.*)$`)

/** The link `pathname` is under, or null where it names none. */
/// aimed('/cookbook/_preview/t/about/') -> { app: 'cookbook', ticket: 't', mount: '/cookbook/_preview/t/', path: '/about/' }
/// aimed('/cookbook/_preview/t/') -> { app: 'cookbook', ticket: 't', mount: '/cookbook/_preview/t/', path: '/' }
/// aimed('/cookbook/_preview/t') -> null
/// aimed('/cookbook/about') -> null
export let aimed = (pathname: string): Aimed | null => {
  let m = ADDRESS.exec(pathname)
  return m &&
    { app: m[1], ticket: m[2], mount: mountOf(m[1], m[2]), path: `/${m[3]}` }
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

/** What a link's ticket names: the draft it shows (`of`), as whom. A ticket
 * sealed before each draft had its own link names the app's (`app.followed`)
 * as `link`, or before that as `draft`, and shows the draft no author holds.
 * A ticket for a paired TV names its `screen`: it reads the draft as a
 * viewer, and only while that screen stays paired with the person. */
export type Ticket = {
  app: string
  space: string
  person: string
  of?: string
  link?: string
  draft?: string
  screen?: string
}

/** The draft, or the app's link, a ticket names; null where it names none. */
/// named({ app: 'a', space: 's', person: 'p', link: 'l', draft: 'd' }) -> 'l'
/// named({ app: 'a', space: 's', person: 'p' }) -> null
export let named = (t: Ticket): string | null => {
  let name = t.of ?? t.link ?? t.draft
  return typeof name == 'string' ? name : null
}

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
 * its own (`followed`), so a link sealed then keeps showing it. */
/// linkFor({ slug: 'a', followed: 'old' }, { eid: 'd', by: null }) -> 'old'
/// linkFor({ slug: 'a', followed: 'old' }, { eid: 'd', by: 'p' }) -> 'd'
export let linkFor = (app: Linked, d: Drafting): string =>
  !d.by && app.followed ? app.followed : d.eid

/** The draft a ticket shows among the app's: the one it names, or for a
 * ticket from before each draft had a link, the one no author holds; null
 * once that draft is closed, when the link shows what was released. */
export let shows = <D extends Drafting>(t: Ticket, drafts: D[]): D | null =>
  (t.of ? drafts.find((d) => d.eid == t.of) : drafts.find((d) => !d.by)) ?? null

/** What the directory holds of a ticket's space and app now, and the level
 * its person holds there. */
export type Holding = {
  space: { eid: string; slug: string; trashed?: unknown }
  app: Linked
  role: Level | null
}

/** Whether a ticket still opens its link, asked at `host` for the app `app`
 * names: its app is where it was, in the space it was sealed for, out of the
 * trash, and its person still writes there. A ticket from before each draft
 * had a link holds while the app still follows that link, and a TV's while
 * its screen is still paired with the person (`paired`, whom it is paired
 * with). */
export let admits = (
  t: Ticket,
  { space, app, role }: Holding,
  at: { host: string; app: string; paired?: string | null },
  env: Host = {},
): boolean =>
  (!t.screen || at.paired == t.person) &&
  space.eid == t.space &&
  at.host == spaceHost(env, space.slug) &&
  app.slug == at.app &&
  (!!t.of || app.followed == named(t)) &&
  !app.trashed && !space.trashed && writes(role)

/** Who a link's request is: a TV reads as a viewer; the app's own worker
 * coming back through its `grant` is who it carries, at the ticket person's
 * level where it carries them; anyone else is the ticket's person, at the
 * level they hold. */
export let viewer = <G extends { person: string | null; role: Level | null }>(
  t: Ticket,
  role: Level,
  grant: G | null,
): G | { person: string; role: Level; via: string } =>
  t.screen
    ? { person: t.person, role: 'viewer', via: t.screen }
    : grant
    ? { ...grant, role: grant.person == t.person ? role : grant.role }
    : { person: t.person, role, via: t.app }

/** The store doors a link's pages reach, from the app's `/api`. */
export let DOORS = [
  '/client.js',
  '/storage.js',
  '/storage',
  '/_draft.js',
  '/_outbox.js',
  '/_wire.js',
  '/me',
  '/graph',
  '/query',
  '/apply',
  '/ws',
  '/vocab',
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
 * (`waiting`) its store doors wait. A TV (`screen`) only reads: its page's
 * writes are refused, and what the page keeps for the person stays in the
 * page. */
/// door({ path: '/api/query', method: 'GET', screen: false, waiting: false }) -> { to: 'api', door: '/query' }
/// door({ path: '/api/query', method: 'GET', screen: false, waiting: true }) -> { to: 'nothing', status: 503 }
/// door({ path: '/api/blob', method: 'GET', screen: false, waiting: false }) -> { to: 'nothing', status: 404 }
/// door({ path: '/api/storage', method: 'PUT', screen: true, waiting: false }) -> { to: 'nothing', status: 403 }
/// door({ path: '/a%20b.css', method: 'GET', screen: false, waiting: false }) -> { to: 'page', file: '/a b.css' }
/// door({ path: '/vocab.json', method: 'GET', screen: false, waiting: false }) -> { to: 'nothing', status: 404 }
export let door = (
  { path, method, screen, waiting }: {
    path: string
    method: string
    screen: boolean
    waiting: boolean
  },
): Door => {
  if (path.startsWith('/api/')) {
    if (waiting) return { to: 'nothing', status: 503 }
    let at = path.slice(4)
    if (!DOORS.includes(at)) return { to: 'nothing', status: 404 }
    if (screen && (at == '/apply' || (at == '/storage' && method != 'GET'))) {
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
