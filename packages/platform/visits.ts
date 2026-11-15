/**
 * `@yaks/platform/visits` — a stranger at a private published app (D-134327).
 * They are served the app itself, furnished from its sample, and their first
 * write gives them a store of their own, a copy of the sample, which their
 * browser alone reaches. Signing up and installing makes that store theirs.
 *
 * The sample is a store of its own that holds the published version's seed
 * and nothing else, made at publish from what was published, never from the
 * owner's own store. A republish that changed neither the declaration nor the
 * seed keeps the store it has ({@link resampled}); one that changed either
 * makes a new one, and the old one is emptied. A visitor's store is a copy, so
 * it never depends on the sample it came from.
 *
 * Who is served what ({@link visiting}): a member is served the app as it is;
 * a stranger with no store of their own reads the sample; a stranger with one
 * is its editor. Everything below the door reads the app's `store`, so the app
 * it is handed is all that changes. A stranger is served the published
 * version, the one the sample was made at: a version the owner hasn't
 * published is theirs alone.
 *
 * The store a browser was given is on its `worked` edge to the app, as
 * `visit{store, blobs, seen, adopted}`, in the directory a host lends as a
 * {@link Ledger}. It is written only once the copy has answered, so nobody is
 * ever sent to a store that isn't there, and only by the first birth: a second
 * one racing it finds the edge written and takes the first
 * ({@link settled}).
 *
 * The platform pays for these stores until one is installed, so they are
 * bounded: a host makes only so many a minute, an app's strangers hold at most
 * {@link CAP}, and the host's sweep erases what nobody can reach any more
 * ({@link lapsed}).
 *
 * Installing with a visit makes the store an app of the installer's own: a new
 * app row names it, and `adopted` names that row ({@link adopt}). From then on
 * the door never serves it as this app again: the page sends the browser to
 * its own app, and what the old page still asks reads the sample.
 *
 * The host does the effects: it makes and empties the stores, reads and writes
 * the directory this module's {@link Ledger} names, and sets the cookies
 * {@link holding} says to tell.
 *
 * ```ts
 * import { visiting } from '@yaks/platform/visits'
 * import { assertEquals } from '@std/assert'
 * let app = {
 *   access: 'private', store: 'ada/notes.1f',
 *   published: { name: 'notes', version: 2 },
 *   demo: { store: 'ada/notes.1f/demo/d', seed: '', version: 2, release: '2' },
 * }
 * let who = { person: null, role: null, via: 'v' }
 * let served = visiting(app.store, app, who, null)
 * assertEquals([served.visit, served.app.store, served.who.role], ['sample', 'ada/notes.1f/demo/d', 'viewer'])
 * ```
 *
 * @module
 */
import type { Level } from '@yaks/member'
import type { Bundle, Comp } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { sha256 } from '@yaks/graph/sha256'
import { edgeEid, link } from '@yaks/edge'
import { cookieValue } from './cookie.ts'
import { seedy } from './files.ts'
import { type Host, url } from './host.ts'
import { instrumentEid } from './instrument.ts'
import { json } from './refused.ts'
import { installAt, signInAt } from './routes.ts'
import type { Files } from './versions.ts'

// ── The sample ───────────────────────────────────────────────────────────

/** An app's sample: its store's handle, the sha it was made from
 * ({@link seedOf}), and the version and release it was made at, which
 * strangers are served. */
export type Sample = {
  store: string
  seed: string
  version: number | null
  release: string | null
}

/** An app as its offer reads: who it is open to, what it publishes, and its
 * sample. */
export type Offered = {
  access: string
  published?: { name: string; version: number } | null
  demo?: Sample | null
}

/** Whether an app keeps a sample: a private app on offer. An open or public
 * app is one store everyone already shares. */
export let sampling = (app: Pick<Offered, 'access' | 'published'>) =>
  app.access == 'private' && !!app.published

/** Whether a stranger can open the app: one everyone shares, or a private
 * one that keeps a sample for them. */
export let opens = (app: Offered) =>
  app.access != 'private' || (sampling(app) && !!app.demo)

/** What a sample is made from, as one sha: the declaration and the seed
 * files' own shas, so a republish that changed neither is the same sample. */
export let seedOf = (declared: unknown, files: Files) =>
  sha256(JSON.stringify([
    declared,
    Object.keys(files).filter(seedy).sort().map((path) => [path, files[path]]),
  ]))

/** What a publish does with the sample the app `had`, made now from `seed`
 * at `version` and `release`: keeps it as it is, keeps its store at the new
 * version (the strangers already in it go on reading it), or makes a new one,
 * after which the host empties the one it had. */
export let resampled = (
  had: Sample | null | undefined,
  now: Omit<Sample, 'store'>,
): { to: 'kept' | 'moved'; sample: Sample } | { to: 'made' } =>
  had?.seed != now.seed
    ? { to: 'made' }
    : had.version == now.version && had.release == now.release
    ? { to: 'kept', sample: had }
    : { to: 'moved', sample: { ...had, ...now } }

/** A new sample's store `id`, beneath its app's own handle. */
export let sampleAt = (handle: string, id: string) => `${handle}/demo/${id}`

// ── Who is served what ───────────────────────────────────────────────────

/** A browser's own store of an app: its handle, where its uploads go, when it
 * was last used, and the app it became once installed. */
export type Visit = {
  store: string
  blobs: string
  seen: string | null
  adopted: string | null
}

/** How a stranger is served: from the sample, from a store of their own, or,
 * once that store became an app of theirs, from the sample again, read-only,
 * while the page sends them on to their own app. */
export type Visiting = 'sample' | 'own' | 'kept'

/** Who is asking, as a visit reads them: their level here, the browser they
 * came in, and, once served a visit, whether its store is an app of theirs
 * yet. */
export type Stranger = {
  person: string | null
  role: Level | null
  via?: string
  guest?: boolean
  visit?: { kept: boolean }
}

/** An app as a stranger is served it: its offer, and what names its store,
 * its uploads, its worker script and its words. */
export type Served = Offered & {
  store?: string | null
  blobs?: string | null
  script?: string | null
  declaration?: string | null
}

/** How long a store nobody claimed is kept unused: the life of the browser
 * cookie that alone reaches it, which use renews as it renews `seen`. */
export let KEPT = 90 * 86_400_000

/** How many stores an app's strangers may hold before it is installed: past
 * it, a stranger's first write is asked to sign up instead. */
export let CAP = 10_000

/** Where every visitor's uploads are kept, each store under a prefix of its
 * own: never an app's files, so erasing one touches nobody else's bytes. */
export let VISITS = '.visits/'

/** A browser's new store `id`, beneath its app's own handle, and where its
 * uploads go. */
export let visitAt = (handle: string, id: string) => ({
  store: `${handle}/visit/${id}`,
  blobs: `${VISITS}${id}/blobs/`,
})

/** Whether this caller is a stranger the app keeps a sample for, signed in or
 * not: their browser is who they are. */
export let visitable = (app: Offered, who: Stranger) =>
  !who.role && !!who.via && sampling(app) && !!app.demo

/** Whether the app is served from its sample: to a stranger who has not
 * written yet. */
export let onSample = (app: Pick<Served, 'demo' | 'store'>) =>
  !!app.demo && app.store == app.demo.store

/**
 * The app and caller a request is served as. A member, an app with no sample,
 * and someone whose invitation waits are served as they came. A stranger with
 * a store of their own is its editor; one without reads the sample, and so
 * does one whose store became an app of theirs, with nothing to write there.
 * Either is served the published version (`release`, where it is no longer the
 * live one), pinned to the app's own worker script, which its store's name no
 * longer names. `handle` is the app's own store.
 */
export let visiting = <A extends Served, W extends Stranger>(
  handle: string,
  app: A,
  who: W,
  visit: Visit | null,
  release: Partial<A> | null = null,
): { app: A; who: W; visit: Visiting | null } => {
  if (!visitable(app, who)) return { app, who, visit: null }
  let served = servedOf(handle, app, release)
  let kept = { kept: !!visit?.adopted }
  // A sample they no longer write to: their first write would give them a
  // second store.
  if (visit?.adopted) {
    return {
      app: { ...served, store: app.demo!.store, demo: null },
      who: { ...who, role: 'viewer', guest: true, visit: kept },
      visit: 'kept',
    }
  }
  return visit
    ? {
      app: { ...served, store: visit.store, blobs: visit.blobs },
      who: { ...who, role: 'editor', guest: true, visit: kept },
      visit: 'own',
    }
    : {
      app: { ...served, store: app.demo!.store },
      who: { ...who, role: 'viewer', guest: true, visit: kept },
      visit: 'sample',
    }
}

// The app as a stranger is served it, whichever store: the published
// release, pinned to the app's own worker script. A release from before each
// had a script of its own runs the one named by the app's handle.
let servedOf = <A extends Served>(
  handle: string,
  app: A,
  release: Partial<A> | null,
): A => ({
  ...app,
  ...release,
  script: (release ? release.script || null : app.script) ?? handle,
  declaration: app.demo!.release ?? app.declaration,
})

/**
 * The app a stranger's visit was served as, for its worker coming back: the
 * grants it was handed name the store that visit read, the sample or a
 * browser's own store, and each is named beneath the app's own `handle`. Null
 * for any other store, or once the app keeps no sample.
 */
export let revisited = <A extends Served>(
  handle: string,
  app: A,
  store: string,
  release: Partial<A> | null = null,
): A | null => {
  if (!sampling(app) || !app.demo) return null
  if (store == app.demo.store) {
    return { ...servedOf(handle, app, release), store }
  }
  let under = `${handle}/visit/`
  let id = store.startsWith(under) ? store.slice(under.length) : ''
  if (!id || id.includes('/')) return null
  return { ...servedOf(handle, app, release), ...visitAt(handle, id) }
}

/**
 * What a signed-out browser holds in the store it stands in, by the app and
 * its visit as the directory says now: the viewer of the sample, the editor
 * of the store its visit gave it, and nothing anywhere else. This is the
 * standing {@link visiting} serves, read again for a socket that outlives the
 * request that opened it.
 */
export let visitorRole = (
  app: Offered,
  store: string | null,
  visit: Visit | null,
): 'viewer' | 'editor' | null =>
  !sampling(app) || !app.demo || !store
    ? null
    : store == app.demo.store
    ? 'viewer'
    : store == visit?.store && !visit.adopted
    ? 'editor'
    : null

/** Whether a stranger's request is the write that gives them a store of
 * their own, where they have none. */
export let births = (path: string, method: string) =>
  path == '/api/apply' && method == 'POST'

/** What a stranger refused a store of their own is told: signed up, they keep
 * one. Signing in comes back to the page that asked. */
export let unborn = (req: Request, env: Host) =>
  json(
    429,
    'sign_up',
    undefined,
    signInAt(req.headers.get('referer') || req.url, env),
  )

/** What the bar on a visitor's page offers: the page that keeps what they
 * made, and what its button says. */
export type Bar = { keep: string; says: string }

/** The bar a visitor's page wears, or null for anyone else. Keeping it is
 * installing the app: a stranger who is signed in goes straight to the
 * install page, and one who is not signs up on the way there. */
export let barOf = (
  env: Host,
  app: Pick<Offered, 'published'>,
  who: Pick<Stranger, 'person' | 'visit'>,
): Bar | null => {
  let name = app.published?.name
  if (!who.visit || who.visit.kept || !name) return null
  let keep = url(env, installAt(name))
  return who.person
    ? { keep, says: 'Keep it' }
    : { keep: signInAt(keep, env), says: 'Sign up to keep it' }
}

/** Whether a visit's last use is old enough to write down again: at most
 * once an hour. */
export let due = (seen: string | null, now = new Date()) =>
  !seen || now.getTime() - Date.parse(seen) >= 3_600_000

// ── The directory ────────────────────────────────────────────────────────

/** The directory as visits read and write it, lent by the host: a query in
 * the graph's grammar, and a write vouched as the platform's own. */
export type Ledger = {
  query: (line: string) => Promise<Bundle[]>
  apply: (bundles: Bundle[]) => Promise<unknown>
}

/** The edge a browser's visits to an app are kept on. */
export let visitEdge = (via: string, app: string) =>
  edgeEid(instrumentEid(via), 'worked', app)

/** A browser's visit as its edge's `visit` component holds it. */
export let visitOfRow = (comp: Comp | undefined): Visit | null =>
  typeof comp?.store == 'string'
    ? {
      store: comp.store,
      blobs: String(comp.blobs ?? ''),
      seen: typeof comp.seen == 'string' ? comp.seen : null,
      adopted: typeof comp.adopted == 'string' ? comp.adopted : null,
    }
    : null

/** This browser's own store of the app, read from the directory itself and
 * never a copy of it: a store just born is asked for at once. */
export let visitOf = async (
  l: Ledger,
  via: string,
  app: string,
): Promise<Visit | null> => {
  let [row] = await l.query(`.entity.eid=${visitEdge(via, app)} .visit`)
  return visitOfRow(row?.visit as Comp | undefined)
}

/** A store a browser was given, with the edge that names it and its app. */
export type Given = { eid: string; app: string; visit: Visit }

let given = (rows: Bundle[]): Given[] =>
  rows.flatMap((row) => {
    let visit = visitOfRow(row.visit as Comp | undefined)
    let eid = (row.entity as { eid: string }).eid
    let app = String((row.edge as Comp | undefined)?.to ?? '')
    return visit ? [{ eid, app, visit }] : []
  })

/** The browser `via` made `by`'s, unless it is somebody's already: the first
 * person to hold a browser keeps it, as at sign-in. */
export let claim = async (l: Ledger, via: string, by: string) => {
  try {
    await l.apply([{
      entity: { eid: instrumentEid(via) },
      browser: { by },
      $was: { browser: { by: null } },
    }])
  } catch (error) {
    if (!(error instanceof Stale)) throw error
  }
}

/** A browser's new store written on its edge to the app, unless a birth
 * racing it wrote one first. Answers the store the edge holds: this one, or
 * the winner's, where the host empties the copy it made. */
export let settled = async (
  l: Ledger,
  via: string,
  app: string,
  visit: Visit,
): Promise<Visit> => {
  let browser = instrumentEid(via)
  try {
    await l.apply([
      { entity: { eid: browser }, browser: {} },
      {
        ...link(browser, 'worked', app),
        visit: { store: visit.store, blobs: visit.blobs, seen: visit.seen },
        $was: { visit: { store: null } },
      },
    ])
    return visit
  } catch (error) {
    if (!(error instanceof Stale)) throw error
    let kept = await visitOf(l, via, app)
    if (!kept) throw error
    return kept
  }
}

/** Whether the app's strangers hold as many stores as it keeps. */
export let crowded = async (l: Ledger, app: string, cap = CAP) => {
  let { count } = await l.query(
    `.visit .edge.to=${app} !visit.adopted .count`,
  ) as unknown as { count: number }
  return count >= cap
}

/** Every store a browser was given that nobody installed, or only those of
 * one person's browsers, or of one app: an installed one is its app's store,
 * and is reached as the app's. */
export let visits = async (
  l: Ledger,
  only: { by?: string; app?: string } = {},
): Promise<Given[]> =>
  given(
    await l.query(
      [
        '.visit !visit.adopted',
        ...only.by ? [`.edge.from.browser.by=${only.by}`] : [],
        ...only.app ? [`.edge.to=${only.app}`] : [],
        '?edge',
      ].join(' '),
    ),
  )

/**
 * The stores nobody can reach any more, which the sweep erases: one nobody
 * claimed, unused for {@link KEPT}, and one whose person closed their account
 * without installing it. `by` keeps a dead person's id, so a closed account is
 * a `by` with no person behind it.
 */
export let lapsed = async (l: Ledger, now = new Date()): Promise<Given[]> => {
  let since = new Date(now.getTime() - KEPT).toISOString()
  return given([
    ...await l.query(
      `.visit !visit.adopted !edge.from.browser.by .visit.seen<"${since}" ?edge`,
    ),
    ...await l.query(
      '.visit !visit.adopted .edge.from.browser.by ' +
        '!edge.from.browser.by.email ?edge',
    ),
  ])
}

// `adopted` moved from `was` to `is` on the visit's edge, refused with Stale
// where it no longer holds `was`.
let adopted = (
  l: Ledger,
  via: string,
  app: string,
  was: string | null,
  is: string | null,
) =>
  l.apply([{
    entity: { eid: visitEdge(via, app) },
    visit: { adopted: is },
    $was: { visit: { adopted: was } },
  }])

/** The visit's store taken by the app row `eid`, unless another install took
 * it first, which refuses with Stale. */
export let adopt = (l: Ledger, via: string, app: string, eid: string) =>
  adopted(l, via, app, null, eid).then(() => {})

/** An adoption whose app row could not be written, put back so the store
 * waits for the next install. */
export let unadopt = (l: Ledger, via: string, app: string, eid: string) =>
  adopted(l, via, app, eid, null).then(() => {})

/** This visit's last use written down. */
export let used = (l: Ledger, via: string, app: string, now = new Date()) =>
  l.apply([{
    entity: { eid: visitEdge(via, app) },
    visit: { seen: now.toISOString() },
  }]).then(() => {})

// ── The stores a browser says it holds ───────────────────────────────────
//
// Almost no stranger holds a store of the app they look at, yet each of their
// requests (the page, each file, each query) asked the directory whether they
// did: 35 of the 50 ms each one spent at ORD (T-133873). The browser says so
// itself instead, in cookies set on the answers that learn it: `yak_stores`
// once all its stores were read, and `yak_store_<app>` for each one, every
// cookie holding the browser it speaks for. The directory is still asked
// about a store the cookies name, so a cookie only ever spares a read, and
// cookies of another browser, or none at all, mean its stores are read whole,
// once; a browser that came with no instrument at all holds nothing, and is
// told so unasked. A cookie of its own per store, because the answer that read
// the stores and the one that made a store can cross: each sets only its own
// names, and neither undoes the other.

/** The cookie saying a browser's stores were read, and so that each store it
 * holds has a cookie of its own. */
export let STORES = 'yak_stores'

let tag = (eid: string) => eid.replaceAll('-', '').slice(0, 16)

/** What every one of a browser's store cookies holds: the browser it speaks
 * for. */
export let holder = (via: string) => tag(instrumentEid(via))

/** The cookie naming a browser's store of one app. */
export let storeCookie = (app: string) => `yak_store_${tag(app)}`

/**
 * This browser's own store of the app, as {@link visitOf} answers it, read
 * only where its cookies leave the answer open, and the cookies its answer is
 * to set. `cookie` is its Cookie header, and `newcomer` whether the host gave
 * it its instrument just now.
 */
export let holding = async (
  l: Ledger,
  said: { cookie: string | null; newcomer: boolean },
  via: string,
  app: string,
): Promise<{ visit: Visit | null; tell: string[] }> => {
  let me = holder(via)
  if (said.newcomer) return { visit: null, tell: [STORES] }
  if (cookieValue(said.cookie, STORES) == me) {
    return {
      visit: cookieValue(said.cookie, storeCookie(app)) == me
        ? await visitOf(l, via, app)
        : null,
      tell: [],
    }
  }
  let held = given(
    await l.query(`.visit .edge.from=${instrumentEid(via)} ?edge`),
  )
  return {
    visit: held.find((g) => g.app == app)?.visit ?? null,
    tell: [STORES, ...held.map((g) => storeCookie(g.app))],
  }
}
