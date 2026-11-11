// Keep builder provenance when a release arrives, and delete an upload's
// bytes once its row is gone.
import { extraction } from '../documents.ts'
import { preserve } from '@yaks/builders'
import type { Bundle } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { maintenance } from '../used.ts'
import { mourned } from '../deaths.ts'
import { blobPrefix, released } from '../blob-key.ts'
import { r2Objects } from '../lib/objects.ts'
import { formPost } from '../form-mail.ts'
import { noticePost } from '../notices.ts'
import { refundSale } from '../service-refunds.ts'
import { noticeEnabled } from '../notices-vocab.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  return {
    refund_sale: refundSale(at),
    form_post: formPost(at),
    ...(noticeEnabled(at.graph.vocab) ? { notice_post: noticePost(at) } : {}),
    document_extract: maintenance((event, _tx, _write, attempt) =>
      extraction(at, event.entity.eid, attempt)
    ),
    builder_install: maintenance(async () => {
      let writes: Bundle[] = []
      if (at.graph.vocab.comp('builder')) {
        for (let builder of await at.graph.read('.builder&*')) {
          writes.push(
            ...await at.graph.storage.tx((tx) =>
              preserve(tx, builder, at.graph.vocab)
            ),
          )
        }
      }
      if (writes.length) await at.graph.apply(writes, { trusted: true })
    }),
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
