// Every app row says where its uploads are kept (app.blobs), which app_new has
// written at birth since D-134327. A row born before then kept them beneath
// its own files (file-root.ts `ownedPrefix`), and this writes that prefix down,
// so no byte moves. Only the directory holds app rows.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { blobPrefix } from './blob-key.ts'
import { PLATFORM_STORE } from './door.ts'
import type { Rule } from './mover.ts'

/**
 * The patch that writes down where one app's uploads already are, or none
 * where its space keeps no handle to root them under.
 *
 * ```ts
 * import { blobsMove } from './blobs-move.ts'
 * import { assertEquals } from '@std/assert'
 * let space = (store?: string) => () =>
 *   [{ entity: { eid: 's' }, space: { slug: 'ada', store } }]
 * let app = (o: Record<string, unknown>) => ({
 *   entity: { eid: 'a' },
 *   app: { space: 's', ...o },
 * })
 * let blobs = (row: ReturnType<typeof app>, read = space('ada')) =>
 *   blobsMove(row, read).map((b) => b.app)
 * assertEquals(blobs(app({ slug: 'notes' })), [{ blobs: 'ada/notes/blobs/' }])
 * assertEquals(blobs(app({ slug: 'notes', files: 'ada/.apps/a' })), [
 *   { blobs: 'ada/.apps/a/blobs/' },
 * ])
 * assertEquals(blobs(app({ slug: 'notes' }), space()), [])
 * ```
 */
export let blobsMove = (
  row: Bundle,
  read?: (line: string) => Bundle[],
): Bundle[] => {
  let app = row.app as Comp
  if (app.blobs != null) return []
  if (!read) throw new Error("an app's uploads are rooted in its space")
  let [space] = read(`.entity.eid=${app.space}&.space&*`)
  let store = (space?.space as Comp | undefined)?.store
  let slug = app.slug ?? (row.former as Comp | undefined)?.slug
  if (typeof store != 'string' || typeof slug != 'string') return []
  let files = typeof app.files == 'string' ? app.files : null
  return [{
    entity: { eid: row.entity.eid },
    app: { blobs: blobPrefix({ store }, { slug, files }) },
    $was: { app: { blobs: token(app.blobs), files: token(app.files) } },
  }]
}

export let blobsRule: Rule = {
  mark: 'yak/store/app-blobs/1',
  stores: [PLATFORM_STORE],
  live: 'all',
  find: '.app !app.blobs&*',
  move: blobsMove,
}
