// Trash dormancy notification.
import type { Bundle } from '@yaks/graph'
import { delivered } from '../trash.ts'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    ...(at.env.STORE
      ? {
        notify_trash: async (event, tx, _write, attempt) => {
          try {
            let [row] = await tx.get([event.entity.eid])
            if (!row || row.tombstone) return
            let apps: Bundle[] = row.app
              ? [row]
              : row.space
              ? await tx.read(`.app.space=${row.entity.eid} .app`) as Bundle[]
              : []
            for (let app of apps) {
              await delivered(at.env.STORE!, tx, app.entity.eid)
            }
          } catch (error) {
            // This acknowledgement is mandatory, not a best-effort action with
            // three attempts. Keep its durable run pending with bounded backoff
            // until the store answers, even after repeated outages.
            await attempt?.progressed()
            throw Object.assign(
              error instanceof Error ? error : new Error(String(error)),
              { retry: { after: 60000 } },
            )
          }
        },
      }
      : {}),
  }
}
