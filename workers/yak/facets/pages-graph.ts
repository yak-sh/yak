// The directory's writes that change what an address serves, purged from the
// edge before the write answers (T-124418). A page Site keeps (page-cache.ts)
// is tagged with the app that answered it and its space, so a deploy or a
// setting of one app purges that app's pages, and a change to how a space
// routes its paths (an app born, renamed, trashed or made home, the space
// renamed, its plan or its quota) purges the whole space.
//
// After the commit and before the answer, because the writer's next look at
// the address must be what it wrote: app_deploy, app_set and the rest answer
// only once their purge has. Every door writes the directory through here, so
// none has to remember to. A purge lost to a crash between the two leaves a
// page no longer than its short lifetime (page-cache.ts `KEPT`).
//
// A release is the exception (T-124483). It purges its app's pages as it
// raises its fence (tools.ts `released`), beside its own work rather than
// after it, and while the fence is up Site keeps none of them (page-cache.ts
// `keep`). So the commit that lowers the fence owes its app nothing, and
// app_deploy answers once that first purge has.
//
// So is an app before its first release (T-143070). It answers nothing at its
// address, so what Site kept there (the space's 404, or that nothing) still
// stands, and no write to it owes a purge: its birth answers without waiting
// on one. Its first release purges its space as it raises its fence, which
// takes those pages out before it serves anything. A file it published is
// shown, so an app with one, or a write to what it publishes, owes as any
// other does.
//
// The listings (home and /gallery, site.ts) are the site's, and a write to a
// published app owes them only when it changes what they show of it
// (`LISTING`, T-143236): a purge empties them in every colo, and agents
// release published examples many times an hour.
import type { Bundle, Hook, Plugin, Tx } from '@yaks/graph'
import type { Options } from './store.ts'
import { APP_PARTS, idOf, publishingOf, SPACE_PARTS } from '../directory.ts'
import { appTag, cardTag, purge, SITE_TAG, spaceTag } from '../purge.ts'

// What a row is made of (directory.ts) is what its pages can show, except
// these: an app's draft, its counters and its gallery listing, and a space's
// bills and letters. A part added to either row is purged until it is named
// here.
let UNSEEN = [
  'meter',
  'gallery',
  'screenshot',
  'notified',
  'seller',
  'fee',
  'budget',
  'starter',
  'visitor_share',
]
let DRAFT = ['draft', 'fence', 'followed']
// A space's routing: which app answers which path, and whether any does.
let ROUTING = ['home', 'trashed', 'former']
// What the kept apex pages show beside apps: the listings, and the platform's
// fee, which /pricing quotes (sell.ts `priceAt`).
let LISTED = ['gallery', 'screenshot', 'integration', 'listed', 'fee']
// What home and /gallery show of a published app beside its listing
// (gallery.ts `shown`): its offer, its title, where it answers, and who may
// open it. A release changes none of these, so it leaves them in the cache.
let LISTING = ['published', 'doc', 'installed', 'demo', ...ROUTING]
let lists = (b: Bundle) =>
  has(b, LISTING) || sets(b.app, ['slug', 'space', 'access'])
let PARTS = [...new Set(['app', 'space', ...APP_PARTS, ...SPACE_PARTS])]
let SHOWN = PARTS.filter((part) => !UNSEEN.includes(part))

let has = (b: Bundle, names: string[]) => names.some((name) => name in b)
let sets = (comp: unknown, props: string[]) =>
  !!comp && typeof comp == 'object' && props.some((p) => p in comp)
// Whether a patch lowers a release fence: the release's commit, or its
// refusal, which shows nothing.
let lowers = (b: Bundle) =>
  sets(b.app, ['fence']) && (b.app as { fence: unknown }).fence == null
// Whether a patch leaves an app that shows nothing: never released, and
// publishing no file.
let unshown = (b: Bundle, row: Bundle) =>
  !(row.app as { version?: number | null }).version && !('publishing' in b) &&
  !publishingOf(row.publishing as { paths?: string | null }).length
// Whether an app's row has a chosen screenshot.
let shot = (row: Bundle) =>
  !!(row.screenshot as { blob?: string | null } | undefined)?.blob
// Whether a patch writes something a page could show.
let shows = (b: Bundle) =>
  SHOWN.some((part) =>
    part in b &&
    (part != 'app' || b.app == null ||
      Object.keys(b.app).some((p) => !DRAFT.includes(p)))
  )

/**
 * The tags a committed batch made wrong, given the rows it left (`rows`
 * reads them back).
 *
 * ```ts
 * import { owed } from './pages-graph.ts'
 * import { assertEquals } from '@std/assert'
 * let rows = async (eids: string[]) =>
 *   eids.map((eid) => ({
 *     entity: { eid },
 *     app: { slug: 'a', space: 's', version: 1 },
 *   }))
 * assertEquals(
 *   await owed([{ entity: { eid: 'x' }, app: { source: 'r2' } }], rows),
 *   ['app:x'],
 * )
 * assertEquals(
 *   await owed([{ entity: { eid: 'x' }, rooted: {} }], rows),
 *   ['app:x'],
 * )
 * assertEquals(
 *   await owed([{ entity: { eid: 'x' }, app: { slug: 'b' } }], rows),
 *   ['space:s'],
 * )
 * assertEquals(
 *   await owed([{ entity: { eid: 'x' }, app: { draft: 'd' } }], rows),
 *   [],
 * )
 * // A file published or unpublished at an app's address, which lists it.
 * assertEquals(
 *   await owed([{ entity: { eid: 'x' }, publishing: { paths: '["p"]' } }], rows),
 *   ['app:x'],
 * )
 * // A release's commit: its pages went as its fence rose.
 * assertEquals(
 *   await owed([{ entity: { eid: 'x' }, app: { version: 2, fence: null } }], rows),
 *   [],
 * )
 * // An app born, or anything else before its first release: it shows nothing.
 * let unreleased = async (eids: string[]) =>
 *   eids.map((eid) => ({
 *     entity: { eid },
 *     app: { slug: 'b', space: 's', version: 0 },
 *   }))
 * let born = { entity: { eid: 'y' }, app: { slug: 'b', space: 's', version: 0 } }
 * assertEquals(await owed([born], unreleased), [])
 * // Until it publishes a file there.
 * assertEquals(
 *   await owed([{ entity: { eid: 'y' }, publishing: { paths: '["p"]' } }], unreleased),
 *   ['app:y'],
 * )
 * // A published app's release moves its card, and nothing the listings say;
 * // retitling it changes them.
 * let offered = async (eids: string[]) =>
 *   eids.map((eid) => ({
 *     entity: { eid },
 *     app: { slug: 'a', space: 's', version: 2 },
 *     published: { name: 'a' },
 *   }))
 * let release = { entity: { eid: 'x' }, app: { version: 2, source: 'r', fence: null } }
 * assertEquals(await owed([release], offered), ['card:x'])
 * assertEquals(
 *   await owed([{ entity: { eid: 'x' }, doc: { title: 'b' } }], offered),
 *   ['site', 'app:x'],
 * )
 * // A new fee changes what /pricing quotes.
 * assertEquals(await owed([{ entity: { eid: 'm' }, fee: { bps: 250 } }], offered), ['site'])
 * ```
 */
export let owed = async (
  applied: Bundle[],
  rows: (eids: string[]) => Promise<Bundle[]>,
): Promise<string[]> => {
  let tags = new Set<string>()
  if (applied.some((b) => has(b, LISTED) || b.tombstone)) tags.add(SITE_TAG)
  for (let b of applied) {
    if (!b.tombstone) continue
    tags.add(appTag(b.entity.eid))
    tags.add(spaceTag(b.entity.eid))
  }
  let touched = applied.filter((b) => !b.tombstone && shows(b))
  let now = new Map(
    (touched.length ? await rows(touched.map((b) => b.entity.eid)) : [])
      .map((row) => [row.entity.eid, row]),
  )
  for (let b of touched) {
    let row = now.get(b.entity.eid)
    if (row?.app) {
      if ((row.published || 'published' in b) && lists(b)) tags.add(SITE_TAG)
      // A card with no screenshot points where its files say (gallery.ts
      // `CARD`), so a release of a published app moves it.
      if (row.published && sets(b.app, ['source']) && !shot(row)) {
        tags.add(cardTag(b.entity.eid))
      }
      if (unshown(b, row)) continue
      let app = row.app as { space: string | { eid: string } }
      if (has(b, ROUTING) || sets(b.app, ['slug', 'space'])) {
        tags.add(spaceTag(idOf(app.space)))
      } else if (shows(b) && !lowers(b)) tags.add(appTag(b.entity.eid))
    } else if (row?.space) {
      if (sets(b.space, ['slug']) || has(b, ROUTING)) tags.add(SITE_TAG)
      if (shows(b)) tags.add(spaceTag(b.entity.eid))
    }
  }
  return [...tags]
}

export let plugins = (_host: unknown, options: Options): Plugin[] => {
  let effect: Hook = Object.assign(
    async (applied: Bundle[], tx: Tx) => {
      let { env, meta } = options.store
      if (!meta || !env.PURGER) return applied
      await purge(env, await owed(applied, async (eids) => await tx.get(eids)))
      return applied
    },
    { keys: [...PARTS, ...LISTED, 'tombstone'] },
  )
  return [{ name: 'yak/pages', admission: () => true, hooks: { effect } }]
}
