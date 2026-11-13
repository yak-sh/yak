// The directory's writes that change what an address serves, purged from the
// edge before the write answers (T-124418). A page Site keeps (page-cache.ts)
// is tagged with the app that answered it and its space, so a deploy or a
// setting of one app purges that app's pages, and a change to how a space
// routes its paths (an app renamed, trashed or made home, the space
// renamed, its plan or its quota), or what its index lists of an app (its
// title, its gallery pill, who may open it), purges the whole space.
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
// A seat written in a space purges it too: a person signed in with none is
// shown its index as an outsider, kept under their session (page-cache.ts),
// and once they hold one theirs is a member's. A seat taken away owes
// nothing, since a member's index was never kept.
//
// A custom domain's own address keeps its pages tagged with its hostname row
// (site.ts `atDomain`), so a domain attached, detached, moved or shown to be
// its owner's purges them, and a detach answers once its pages are gone.
//
// The listings (home and /gallery, site.ts) are the site's, and a write to a
// published app owes them only when it changes what they show of it
// (`LISTING`, T-143236): a purge empties them in every colo, and agents
// release published examples many times an hour.
//
// A delete owes what the entity it took could have shown: an app, a space, a
// listed row. A row no page shows owes nothing, so neither a sign-in code
// buried nor an effect's finished run purges a page (T-148652): each was a
// purge of every listing, waiting on the account's purge bucket before the
// write answered. What a delete takes is read before it does
// (`quietened`); a casualty of its cascade, unread, owes as it always has.
import type { Bundle, Hook, Plugin, Tx } from '@yaks/graph'
import { hook, type HookContext } from '@yaks/graph/plugin'
import { dead, TOMBSTONE } from '@yaks/graph/bundle'
import { after } from '@yaks/fp'
import type { Options } from './store.ts'
import { APP_PARTS, idOf, publishingOf, SPACE_PARTS } from '../directory.ts'
import {
  appTag,
  cardTag,
  hostTag,
  purge,
  SITE_TAG,
  spaceTag,
} from '../purge.ts'

// What a row is made of (directory.ts) is what its pages can show, except
// these: an app's draft, its counters and its gallery listing (but for the
// pill its space's index shows, `indexed`), and a space's bills and letters.
// A part added to either row is purged until it is named here.
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
// What the kept apex pages show beside apps: the listings (an integration's
// among them, which `published` puts in the integration directory), and the
// platform's fee, which /pricing quotes (sell.ts `priceAt`).
let LISTED = ['gallery', 'screenshot', 'integration', 'published', 'fee']
// What home and /gallery show of a published app beside its listing
// (gallery.ts `shown`): its offer, its title, where it answers, and who may
// open it. A release changes none of these, so it leaves them in the cache.
let LISTING = ['published', 'doc', 'installed', 'demo', ...ROUTING]
let lists = (b: Bundle) =>
  has(b, LISTING) || sets(b.app, ['slug', 'space', 'access'])
// What a space's index lists of an app beside its routing (apps.ts `shelf`):
// its title, its gallery pill and who may open it. Before its first release a
// stranger is shown it only once it publishes a file.
let indexed = (b: Bundle) =>
  has(b, ['doc', 'gallery']) || sets(b.app, ['access'])
let released = (row: Bundle) =>
  !!(row.app as { version?: number | null }).version
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
  !released(row) && !('publishing' in b) &&
  !publishingOf(row.publishing as { paths?: string | null }).length
// Whether an app's row has a chosen screenshot.
let shot = (row: Bundle) =>
  !!(row.screenshot as { blob?: string | null } | undefined)?.blob
// A custom domain's row: what its own address answers (site.ts `atDomain`).
let DOMAIN = ['hostname', 'verified']
// Whether an entity as it stands holds anything a page shows.
let shown = (row: Bundle) => has(row, [...SHOWN, ...LISTED, 'hostname'])
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
 * // Until it publishes a file there, which its space's index lists.
 * assertEquals(
 *   await owed([{ entity: { eid: 'y' }, publishing: { paths: '["p"]' } }], unreleased),
 *   ['space:s'],
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
 *   ['site', 'space:s'],
 * )
 * // A seat written in a space: a person who held none is shown its index
 * // as a member now.
 * let seats = async (eids: string[]) =>
 *   eids.map((eid) => ({ entity: { eid }, member: { space: 's', person: 'p' } }))
 * assertEquals(await owed([{ entity: { eid: 'm' }, member: { role: 'owner' } }], seats), ['space:s'])
 * // A custom domain attached, moved or shown to be its owner's: what its
 * // own address answers.
 * let domain = async (eids: string[]) =>
 *   eids.map((eid) => ({ entity: { eid }, hostname: { name: 'her.com', serves: 'x' } }))
 * assertEquals(await owed([{ entity: { eid: 'h' }, hostname: { to: null } }], domain), ['host:h'])
 * assertEquals(await owed([{ entity: { eid: 'h' }, verified: { at: 'now' } }], domain), ['host:h'])
 * // A new fee changes what /pricing quotes.
 * assertEquals(await owed([{ entity: { eid: 'm' }, fee: { bps: 250 } }], offered), ['site'])
 * // A delete owes every page its entity could have been on, unless it was
 * // one no page shows.
 * let buried = { entity: { eid: 'c' }, tombstone: {} }
 * assertEquals(await owed([buried], rows), ['site', 'app:c', 'space:c', 'host:c'])
 * assertEquals(await owed([buried], rows, new Set(['c'])), [])
 * ```
 */
export let owed = async (
  applied: Bundle[],
  rows: (eids: string[]) => Promise<Bundle[]>,
  quiet: ReadonlySet<string> = new Set(),
): Promise<string[]> => {
  let tags = new Set<string>()
  let gone = applied.filter((b) => b.tombstone && !quiet.has(b.entity.eid))
  if (gone.length || applied.some((b) => has(b, LISTED))) tags.add(SITE_TAG)
  for (let b of gone) {
    tags.add(appTag(b.entity.eid))
    tags.add(spaceTag(b.entity.eid))
    tags.add(hostTag(b.entity.eid))
  }
  let touched = applied.filter((b) =>
    !b.tombstone &&
    (shows(b) || 'gallery' in b || 'member' in b || has(b, DOMAIN))
  )
  let now = new Map(
    (touched.length ? await rows(touched.map((b) => b.entity.eid)) : [])
      .map((row) => [row.entity.eid, row]),
  )
  for (let b of touched) {
    let row = now.get(b.entity.eid)
    let seat = row?.member as { space: string | { eid: string } } | undefined
    if (seat && 'member' in b) tags.add(spaceTag(idOf(seat.space)))
    if (row?.hostname && has(b, DOMAIN)) tags.add(hostTag(b.entity.eid))
    if (row?.app) {
      if ((row.published || 'published' in b) && lists(b)) tags.add(SITE_TAG)
      // A card with no screenshot points where its files say (gallery.ts
      // `CARD`), so a release of a published app moves it.
      if (row.published && sets(b.app, ['source']) && !shot(row)) {
        tags.add(cardTag(b.entity.eid))
      }
      if (unshown(b, row)) continue
      let app = row.app as { space: string | { eid: string } }
      if (
        has(b, ROUTING) || sets(b.app, ['slug', 'space']) || indexed(b) ||
        'publishing' in b && !released(row)
      ) {
        tags.add(spaceTag(idOf(app.space)))
      } else if (shows(b) && !lowers(b)) tags.add(appTag(b.entity.eid))
    } else if (row?.space) {
      if (sets(b.space, ['slug']) || has(b, ROUTING)) tags.add(SITE_TAG)
      if (shows(b)) tags.add(spaceTag(b.entity.eid))
    }
  }
  return [...tags]
}

// The entities a batch deletes by name.
let killing = (bundles: Bundle[]) => [
  ...new Set(bundles.filter(dead).map((b) => b.entity.eid)),
]

export let plugins = (_host: unknown, options: Options): Plugin[] => {
  // Each attempt's deleted entities that held nothing a page shows, read
  // while they stand and heard by the same attempt's effect.
  let quiet = new WeakMap<object, Set<string>>()
  let quietened = hook(['$delete', TOMBSTONE], (bundles, tx, _err, context) => {
    let at = context?.transaction
    let killed = killing(bundles)
    let { env, meta } = options.store
    if (!at || !killed.length || !meta || !env.PURGER) return bundles
    return after(tx.get(killed), (rows) => {
      quiet.set(
        at,
        new Set(rows.filter((r) => !shown(r)).map((r) => r.entity.eid)),
      )
      return bundles
    })
  })
  let effect: Hook = Object.assign(
    async (
      applied: Bundle[],
      tx: Tx,
      _err?: unknown,
      context?: HookContext,
    ) => {
      let { env, meta } = options.store
      if (!meta || !env.PURGER) return applied
      let still = context?.transaction && quiet.get(context.transaction)
      await purge(
        env,
        await owed(applied, async (eids) => await tx.get(eids), still),
      )
      return applied
    },
    {
      keys: [...new Set([...PARTS, ...LISTED, 'member', ...DOMAIN, TOMBSTONE])],
    },
  )
  return [{
    name: 'yak/pages',
    admission: () => true,
    // What `quietened` reads, gathered with the batch.
    wants: (bundles) => {
      let killed = killing(bundles)
      return killed.length ? [{ eids: killed }] : []
    },
    hooks: { precondition: quietened, effect },
  }]
}
