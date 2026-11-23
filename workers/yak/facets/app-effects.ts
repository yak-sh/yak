// yaks.app's yak/app effects: the Cloudflare work beside what
// @yaks/platform/app-effects runs on any host (a store's builders kept with
// their provenance): a document's text, a hearing, an upload no longer
// served, a death told to the space, a refund and a notice.
import { extraction } from '../documents.ts'
import { effects as everywhere } from '@yaks/platform/app-effects'
import type { Host } from '@yaks/host'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { maintenance } from '@yaks/platform/lent'
import { mourned } from '../deaths.ts'
import { withdrew } from '../withdrawn.ts'
import { noticePost } from '../notices.ts'
import { refundSale } from '../service-refunds.ts'
import { noticeEnabled } from '@yaks/platform/notices-vocab'

export let effects = (host: Host, options: Options): Handlers => {
  let at = options.store
  return {
    ...everywhere(host, options),
    refund_sale: refundSale(at),
    ...(noticeEnabled(at.graph.vocab) ? { notice_post: noticePost(at) } : {}),
    // A decision asked in its person's Updates (app-decisions.ts).
    decision_ask: async (event) =>
      await (await import('../app-decisions.ts')).asking(
        at,
        event.entity.eid,
      ),
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
    // An upload no row names is served no more: the gateway keeps whether
    // each upload is served under its app's mark (files.ts `servableOf`),
    // which this moves. Retried until the directory takes it, since until
    // then the gateway goes on answering yes. The bytes stay, for recovery.
    delete_upload: maintenance(async (_event, _tx, _write, attempt) => {
      let { STORE } = at.env
      if (!STORE || !at.app || at.context) return
      try {
        await withdrew({ STORE }, at.app)
      } catch (error) {
        await attempt?.progressed()
        throw Object.assign(
          error instanceof Error ? error : new Error(String(error)),
          { retry: { after: 5_000 } },
        )
      }
    }),
  }
}
