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
// A release sends its purge as it begins, not as it commits (T-124483): a
// purge takes up to most of a second to land, longer when rate limited, and
// so it runs beside the release's own work instead of after it. Raising the
// fence (versions.ts `fenced`) purges the app's pages, and while the fence
// is up Site keeps none of them (page-cache.ts `keep`), so the commit has
// nothing new to purge: it answers once that first purge has landed, which
// by then it almost always has.
import type { Bundle, Hook, Plugin, Tx } from '@yaks/graph'
import type { Options } from './store.ts'
import { APP_PARTS, idOf, SPACE_PARTS, spaceOf } from '../directory.ts'
import { background, caught } from '../defects.ts'
import { overVisits } from '../meter.ts'
import { appTag, purge, spaceTag } from '../purge.ts'

// What a row is made of (directory.ts) is what its pages can show, except
// these: an app's draft, its counters and its gallery listing, and a space's
// bills and letters. A part added to either row is purged until it is named
// here. A space's meter is read for its quota below.
let UNSEEN = ['meter', 'gallery', 'screenshot', 'notified', 'stripe', 'fee']
let DRAFT = ['draft', 'fence']
// A space's routing: which app answers which path, and whether any does.
let ROUTING = ['home', 'trashed', 'former']
let PARTS = [...new Set(['app', 'space', ...APP_PARTS, ...SPACE_PARTS])]
let SHOWN = PARTS.filter((part) => !UNSEEN.includes(part))

let has = (b: Bundle, names: string[]) => names.some((name) => name in b)
let sets = (comp: unknown, props: string[]) =>
  !!comp && typeof comp == 'object' && props.some((p) => p in comp)
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
 *   eids.map((eid) => ({ entity: { eid }, app: { slug: 'a', space: 's' } }))
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
 * ```
 */
export let owed = async (
  applied: Bundle[],
  rows: (eids: string[]) => Promise<Bundle[]>,
): Promise<string[]> => {
  let tags = new Set<string>()
  for (let b of applied) {
    if (!b.tombstone) continue
    tags.add(appTag(b.entity.eid))
    tags.add(spaceTag(b.entity.eid))
  }
  let touched = applied.filter((b) =>
    !b.tombstone && (shows(b) || sets(b.meter, ['requests']))
  )
  let now = new Map(
    (touched.length ? await rows(touched.map((b) => b.entity.eid)) : [])
      .map((row) => [row.entity.eid, row]),
  )
  for (let b of touched) {
    let row = now.get(b.entity.eid)
    if (row?.app) {
      let app = row.app as { space: string | { eid: string } }
      if (has(b, ROUTING) || sets(b.app, ['slug', 'space'])) {
        tags.add(spaceTag(idOf(app.space)))
      } else if (shows(b)) tags.add(appTag(b.entity.eid))
    } else if (row?.space) {
      // The hourly reading is what moves a space past its quota, and a page
      // kept for a stranger must not outlive that. Said again every hour while
      // over, which is one purge an hour for a space nobody is served in.
      let over = sets(b.meter, ['requests']) &&
        overVisits(spaceOf(row as Parameters<typeof spaceOf>[0]))
      if (shows(b) || over) tags.add(spaceTag(b.entity.eid))
    }
  }
  return [...tags]
}

/**
 * The apps whose release fence a batch raised (a release beginning) or
 * lowered (its commit, or its refusal).
 *
 * ```ts
 * import { fences } from './pages-graph.ts'
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   fences([
 *     { entity: { eid: 'a' }, app: { fence: '1:x' } },
 *     { entity: { eid: 'b' }, app: { version: 2, fence: null } },
 *     { entity: { eid: 'c' }, app: { version: 2 } },
 *   ]),
 *   [{ eid: 'a', up: true }, { eid: 'b', up: false }],
 * )
 * ```
 */
export let fences = (applied: Bundle[]) =>
  applied.flatMap((b) => {
    let app = b.app as { fence?: string | null } | null | undefined
    return b.tombstone || app?.fence === undefined
      ? []
      : [{ eid: b.entity.eid, up: !!app.fence }]
  })

export let plugins = (_host: unknown, options: Options): Plugin[] => {
  // The purge each release sent as it began, by app, true once it landed.
  let begun = new Map<string, Promise<boolean>>()
  let effect: Hook = Object.assign(
    async (applied: Bundle[], tx: Tx) => {
      let { env, meta } = options.store
      let site = env.SITE
      if (!meta || !site?.purge) return applied
      let tags = await owed(applied, async (eids) => await tx.get(eids))
      let waits: Promise<unknown>[] = []
      for (let { eid, up } of fences(applied)) {
        let tag = appTag(eid)
        if (up) {
          let sent = purge(site, [tag]).then(() => true, (e) => {
            caught(e, { request: 'release purge', app: eid })
            return false
          })
          begun.set(eid, sent)
          background(sent.then(() => {}))
          continue
        }
        let sent = begun.get(eid)
        begun.delete(eid)
        if (!sent || !tags.includes(tag)) continue
        // Committed: its pages went as it began and none was kept since, so
        // it waits on that purge, and sends its own only if that one failed.
        tags = tags.filter((t) => t != tag)
        waits.push(sent.then((ok) => ok ? undefined : purge(site, [tag])))
      }
      await Promise.all([purge(site, tags), ...waits])
      return applied
    },
    { keys: [...PARTS, 'tombstone'] },
  )
  return [{ name: 'yak/pages', admission: () => true, hooks: { effect } }]
}
