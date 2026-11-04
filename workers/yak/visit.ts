// A stranger at a private published app (D-134327). They are served the app
// itself, furnished from its sample (sample.ts), and their first write gives
// them a store of their own, a copy of the sample, which their browser alone
// reaches. Signing up and installing makes that store theirs.
//
// The door (apps.ts) asks `visiting` right after it knows who is asking: a
// member is served the app as it is; a stranger with no store of their own
// reads the sample; a stranger with one is its editor. Everything below the
// door reads `storeName(space, app)`, so the app it is handed is all that
// changes. A stranger is served the published version, the one the sample was
// made at: a version the owner hasn't published is theirs alone.
//
// The store a browser was given is on its `worked` edge to the app, as
// `visit{store, blobs, seen, adopted}`, in the directory. It is written only
// once the copy has answered, so nobody is ever sent to a store that isn't
// there, and only by the first birth: a second one racing it finds the edge
// written, empties its own copy and takes the first.
//
// The platform pays for these stores until one is installed, so they are
// bounded: a source makes at most BIRTH_RATE of them a minute (apps.ts), an
// app's strangers hold at most CAP, and the daily sweep erases what nobody can
// reach any more (erase.ts `unvisited`): a store nobody claimed, unused for
// as long as the cookie that alone reaches it lives, and one whose person
// closed their account without installing it. The app's own schedule runs in
// each store as it does in the app's, and stops with it.
//
// Installing with `visit` (tools.ts app_install) makes the store an app of the
// installer's own: a new app row names it, and `adopted` names that row. From
// then on the store is that app's, and the door never serves it as this one
// again, which would tell it it belongs to another app: the page sends the
// browser to its own app, and what the old page still asks reads the sample.
import { edgeEid, link } from '@yaks/edge'
import { MOVED } from '@yaks/sync'
import type { Comp } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import {
  type App,
  type Directory,
  scriptOf,
  type Space,
  storeName,
} from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { type Host, url } from './host.ts'
import { instrumentEid } from './instrument.ts'
import { KERNEL, meta } from './meta.ts'
import { COPY } from './relocate.ts'
import { installAt, signInAt } from './route.ts'
import { cleared, sampling } from './sample.ts'
import type { Who } from './session.ts'

/** A browser's own store of an app: its handle, where its uploads go, when it
 * was last used, and the app it became once installed. */
export type Visit = {
  store: string
  blobs: string
  seen: string | null
  adopted: string | null
}

/** The answer on a write that gave its browser a store of its own: the page's
 * client opens its socket again, which now reaches that store. */
export { MOVED }

/** How long a store nobody claimed is kept unused: the life of the browser
 * cookie that alone reaches it (session.ts), which use renews as it renews
 * `seen`. */
export let KEPT = 90 * 86_400_000

/** How many stores an app's strangers may hold before it is installed: past
 * it, a stranger's first write is asked to sign up instead. */
export let CAP = 10_000

/** Where every visitor's uploads are kept, each store under a prefix of its
 * own: never an app's files, so erasing one touches nobody else's bytes. */
export let VISITS = '.visits/'

/** What a stranger is served of a published release that is no longer the
 * app's live one: its files, its worker and its words. */
export type Release = Pick<
  App,
  'version' | 'source' | 'script' | 'worker' | 'lenses'
>

/** How a stranger is served: from the sample, from a store of their own, or,
 * once that store became an app of theirs, from the sample again, read-only,
 * while the page sends them on to their own app. */
export type Visiting = 'sample' | 'own' | 'kept'

/**
 * The app and caller a request is served as. A member, an app with no sample,
 * and someone whose invitation waits are served as they came. A stranger with
 * a store of their own is its editor; one without reads the sample, and so
 * does one whose store became an app of theirs, with nothing to write there. Either is
 * served the published version (`release`, where it is no longer the live
 * one), pinned to the app's own worker script, which its store name no longer
 * names.
 *
 * ```ts
 * import { onSample, visiting } from './visit.ts'
 * import { assertEquals } from '@std/assert'
 * let space = { slug: 'ada' } as Parameters<typeof visiting>[0]
 * let app = {
 *   eid: 'a', slug: 'notes', store: 'ada/notes.1f7c3e', access: 'private',
 *   published: { name: 'notes', version: 2, at: '', about: '' }, version: 2,
 *   demo: { store: 'ada/notes.1f7c3e/demo/d', seed: '', version: 2, release: '2' },
 * } as Parameters<typeof visiting>[1]
 * let who = { person: 'p', role: null, via: 'v' }
 * let sample = visiting(space, app, who, null)
 * assertEquals(sample.visit, 'sample')
 * assertEquals(sample.app.store, 'ada/notes.1f7c3e/demo/d')
 * assertEquals(sample.who.role, 'viewer')
 * assertEquals(sample.who.visit, { kept: false })
 * let own = { store: 'ada/notes.1f7c3e/visit/o', blobs: '.visits/o/blobs/', seen: null, adopted: null }
 * assertEquals(visiting(space, app, who, own).app.store, own.store)
 * assertEquals(visiting(space, app, who, own).who.role, 'editor')
 * assertEquals(visiting(space, app, { ...who, role: 'owner' }, own).visit, null)
 * let kept = visiting(space, app, who, { ...own, adopted: 'b' })
 * assertEquals([kept.visit, kept.app.store, kept.who.role], ['kept', 'ada/notes.1f7c3e/demo/d', 'viewer'])
 * assertEquals(onSample(kept.app), false)
 * ```
 */
export let visiting = (
  space: Space,
  app: App,
  who: Who,
  visit: Visit | null,
  release: Release | null = null,
): { app: App; who: Who; visit: Visiting | null } => {
  if (!visitable(app, who)) return { app, who, visit: null }
  // A release from before each had a script of its own runs the one named by
  // the app's handle.
  let served: App = {
    ...app,
    ...release,
    script: release
      ? release.script || storeName(space, app)
      : scriptOf(space, app),
    declaration: app.demo!.release ?? app.declaration,
  }
  let kept = { kept: !!visit?.adopted }
  // A sample they no longer write to: their first write would give them
  // a second store.
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

/** What the bar on a visitor's page offers (public/visit.js): the page that
 * keeps what they made, and what its button says. */
export type Bar = { keep: string; says: string }

/**
 * The bar a visitor's page wears, or null for anyone else. Keeping it is
 * installing the app: a stranger who is signed in goes straight to the
 * install page, and one who is not signs up on the way there.
 *
 * ```ts
 * import { barOf } from './visit.ts'
 * import { assertEquals } from '@std/assert'
 * let app = { published: { name: 'notes' } } as Parameters<typeof barOf>[1]
 * let visit = { kept: false }
 * assertEquals(barOf({}, app, { person: 'p', role: 'editor', visit }), {
 *   keep: 'https://yaks.app/install?name=notes',
 *   says: 'Keep it',
 * })
 * assertEquals(
 *   barOf({}, app, { person: null, role: 'editor', visit })?.says,
 *   'Sign up to keep it',
 * )
 * assertEquals(barOf({}, app, { person: 'p', role: 'editor' }), null)
 * ```
 */
export let barOf = (env: Host, app: App, who: Who): Bar | null => {
  let name = app.published?.name
  if (!who.visit || who.visit.kept || !name) return null
  let keep = url(env, installAt(name))
  return who.person
    ? { keep, says: 'Keep it' }
    : { keep: signInAt(keep, env), says: 'Sign up to keep it' }
}

/** Whether the app is served from its sample: to a stranger who has not
 * written yet. */
export let onSample = (app: App) => !!app.demo && app.store == app.demo.store

/** Whether this caller is a stranger the app keeps a sample for.
 *
 * TODO(T-134901): a stranger who isn't signed in is held to the sign-in page
 * until an app's store takes a level the door vouches for a browser with no
 * person (graph.ts `vouchOf` gives a `via` none), since the store would refuse
 * their every read. That task drops the `who.person` here. */
export let visitable = (app: App, who: Who) =>
  !who.role && !!who.person && !!who.via && sampling(app) && !!app.demo

/** The edge a browser's visits to an app are kept on (attribution.ts
 * `contributed` writes the same one). */
let edgeOf = (via: string, app: string) =>
  edgeEid(instrumentEid(via), 'worked', app)

let visitOfRow = (comp: Comp | undefined): Visit | null =>
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
  env: Pick<Env, 'STORE'>,
  via: string,
  app: string,
): Promise<Visit | null> => {
  let [row] = await meta(env).query(
    `.entity.eid=${edgeOf(via, app)} .visit`,
  )
  return visitOfRow(row?.visit as Comp | undefined)
}

// The births under way in this isolate, by app and browser: a page that sends
// two writes at once makes one store.
let births = new Map<string, Promise<Visit>>()

/**
 * A store of this browser's own, copied from the app's sample at one instant,
 * then written on its edge. Answers the store the edge holds, which is another
 * birth's where one won the race; the loser's copy is emptied.
 */
export let born = (
  env: Env,
  space: Space,
  app: App,
  via: string,
  now = new Date(),
): Promise<Visit> => {
  let key = `${app.eid} ${instrumentEid(via)}`
  let held = births.get(key)
  if (held) return held
  let birth = bear(env, space, app, instrumentEid(via), now)
    .finally(() => births.delete(key))
  births.set(key, birth)
  return birth
}

let bear = async (
  env: Env,
  space: Space,
  app: App,
  via: string,
  now: Date,
): Promise<Visit> => {
  let id = crypto.randomUUID()
  let store = `${storeName(space, app)}/visit/${id}`
  let copy = await storeOf(env.STORE, app.demo!.store)(
    `${COPY}?to=${encodeURIComponent(store)}`,
    { method: 'POST' },
    KERNEL,
  )
  if (!copy.ok) throw new Error(`visit copy: ${await copy.text()}`)
  await copy.body?.cancel()
  let visit: Visit = {
    store,
    blobs: `${VISITS}${id}/blobs/`,
    seen: now.toISOString(),
    adopted: null,
  }
  try {
    await meta(env).apply([
      { entity: { eid: via }, browser: {} },
      {
        ...link(via, 'worked', app.eid),
        visit: { store: visit.store, blobs: visit.blobs, seen: visit.seen },
        $was: { visit: { store: null } },
      },
    ], KERNEL)
    return visit
  } catch (error) {
    if (!(error instanceof Stale)) throw error
    await cleared(env, store)
    let kept = await visitOf(env, via, app.eid)
    if (!kept) throw error
    return kept
  }
}

/** Whether the app's strangers hold as many stores as it keeps. */
export let crowded = async (
  env: Pick<Env, 'STORE'>,
  app: string,
  cap = CAP,
) => {
  let { count } = await meta(env).query(
    `.visit .edge.to=${app} !visit.adopted .count`,
  ) as unknown as { count: number }
  return count >= cap
}

/** A store a browser was given, with the edge that names it and its app. */
export type Given = { eid: string; app: string; visit: Visit }

let given = (rows: Record<string, unknown>[]): Given[] =>
  rows.flatMap((row) => {
    let visit = visitOfRow(row.visit as Comp | undefined)
    let eid = (row.entity as { eid: string }).eid
    let app = String((row.edge as Comp | undefined)?.to ?? '')
    return visit ? [{ eid, app, visit }] : []
  })

/** Every store a browser was given that nobody installed, or only those of
 * one person's browsers, or of one app: an installed one is its app's store,
 * and is reached as the app's. */
export let visits = async (
  env: Pick<Env, 'STORE'>,
  only: { by?: string; app?: string } = {},
): Promise<Given[]> =>
  given(
    await meta(env).query(
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
 * without installing it. `by` keeps a dead person's id (attribution-vocab.ts),
 * so a closed account is a `by` with no person behind it.
 */
export let lapsed = async (
  env: Pick<Env, 'STORE'>,
  now = new Date(),
): Promise<Given[]> => {
  let since = new Date(now.getTime() - KEPT).toISOString()
  let g = meta(env)
  return given([
    ...await g.query(
      `.visit !visit.adopted !edge.from.browser.by .visit.seen<"${since}" ?edge`,
    ),
    ...await g.query(
      '.visit !visit.adopted .edge.from.browser.by ' +
        '!edge.from.browser.by.email ?edge',
    ),
  ])
}

/** The visit's store taken by the app row `eid`, unless another install took
 * it first, which refuses with Stale. */
export let adopt = async (
  env: Pick<Env, 'STORE'>,
  via: string,
  app: string,
  eid: string,
) => {
  await meta(env).apply([{
    entity: { eid: edgeOf(via, app) },
    visit: { adopted: eid },
    $was: { visit: { adopted: null } },
  }], KERNEL)
}

/** An adoption whose app row could not be written, put back so the store
 * waits for the next install. */
export let unadopt = async (
  env: Pick<Env, 'STORE'>,
  via: string,
  app: string,
  eid: string,
) => {
  await meta(env).apply([{
    entity: { eid: edgeOf(via, app) },
    visit: { adopted: null },
    $was: { visit: { adopted: eid } },
  }], KERNEL)
}

/** Whether a visit's last use is old enough to write down again: at most
 * once an hour, the way used.ts keeps its receipts.
 *
 * ```ts
 * import { due } from './visit.ts'
 * import { assert } from '@std/assert'
 * let at = new Date('2026-11-03T12:00:00Z')
 * assert(due(null, at))
 * assert(!due('2026-11-03T11:30:00Z', at))
 * assert(due('2026-11-03T10:59:00Z', at))
 * ```
 */
export let due = (seen: string | null, now = new Date()) =>
  !seen || now.getTime() - Date.parse(seen) >= 3_600_000

/** This visit's last use written down. */
export let used = async (
  env: Pick<Env, 'STORE'>,
  via: string,
  app: string,
  now = new Date(),
) => {
  await meta(env).apply([{
    entity: { eid: edgeOf(via, app) },
    visit: { seen: now.toISOString() },
  }], KERNEL)
}

/** The published release a stranger is served when the app has moved past
 * it, read once per isolate: a release never changes. */
let releases = new Map<string, Promise<Release | null>>()
export let releaseFor = (
  dir: Pick<Directory, 'deployAt'>,
  app: App,
): Promise<Release | null> => {
  let version = app.demo?.version
  if (version == null || version == app.version) return Promise.resolve(null)
  let key = `${app.eid} ${version}`
  let held = releases.get(key)
  if (held) return held
  let read = dir.deployAt(app, version).then((d) =>
    d
      ? {
        version: d.version,
        source: d.source,
        script: d.script,
        worker: d.worker,
        lenses: d.lenses,
      }
      : null
  )
  read.catch(() => releases.delete(key))
  releases.set(key, read)
  if (releases.size > 256) releases.delete(releases.keys().next().value!)
  return read
}
