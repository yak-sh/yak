// yaks.app's yak/app effects: the Cloudflare work beside what
// @yaks/platform/app-effects runs on any host (a store's builders kept with
// their provenance): a document's text, a hearing, an upload's bytes deleted
// once its row is gone, a death told to the space, a refund and a notice.
import { extraction } from '../documents.ts'
import { effects as everywhere } from '@yaks/platform/app-effects'
import type { Host } from '@yaks/host'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { maintenance } from '@yaks/platform/lent'
import { mourned } from '../deaths.ts'
import { blobPrefix, released } from '../blob-key.ts'
import { r2Objects } from '../lib/objects.ts'
import { noticePost } from '../notices.ts'
import { refundSale } from '../service-refunds.ts'
import { noticeEnabled } from '@yaks/platform/notices-vocab'

export let effects = (host: Host, options: Options): Handlers => {
  let at = options.store
  return {
    ...everywhere(host, options),
    refund_sale: refundSale(at),
    ...(noticeEnabled(at.graph.vocab) ? { notice_post: noticePost(at) } : {}),
    document_extract: maintenance((event, _tx, _write, attempt) =>
      extraction(at, event.entity.eid, attempt)
    ),
    // Loaded as a store first hears, not as every store wakes.
    speech_hear: async (event, _tx, _write, attempt) =>
      await (await import('../hearings.ts')).hearWhole(
        at,
        event.entity.eid,
        attempt,
      ),
    // The bytes sit under the app's current address, so the directory is
    // asked for it at run time, and what names them is read last, after that
    // wait: an upload of the same file meanwhile names them again and keeps
    // them. An app already erased has no bytes left to delete.
    // A death is the whole space's (deaths.ts). Retried until every sibling
    // takes it: a sibling still on older code answers it missing for a while.
    notify_deaths: maintenance(async (event, _tx, _write, attempt) => {
      let { STORE } = at.env
      if (!STORE || !at.app || at.context) return
      try {
        await mourned({ ...at.env, STORE }, at.app, [event.entity.eid])
      } catch (error) {
        await attempt?.progressed()
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { retry: { after: 60_000 } },
        )
      }
    }),
    delete_upload: maintenance(async (event) => {
      let sha = event.entity.eid, { STORE, BLOBS } = at.env
      if (!STORE || !BLOBS || !at.app || !/^[0-9a-f]{64}$/.test(sha)) return
      let { directoryOf } = await import('../directory.ts')
      let found = at.context ?? await directoryOf(STORE).appAt(at.app)
      if (!found) return
      await released(
        at.graph,
        r2Objects(BLOBS),
        blobPrefix(found.space, found.app),
        sha,
      )
    }),
  }
}
