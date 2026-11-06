// The `@yaks/resend/routes` facet: the webhook Resend posts this sender's
// delivery receipts to. A signed receipt updates the letter @yaks/mail
// recorded; a missing letter is a retryable answer, since an Operator may
// still be committing it. Only the endpoint's signing secret authorizes this.
import type { Route } from '@yaks/api'
import type { Graph } from '@yaks/graph'
import { receipted } from '@yaks/mail'
import type { Options } from './options.ts'
import { notification, Unsigned } from './receive.ts'

/** The receipt route, where the options configure one. */
export let routes = (
  host: {
    graph: Pick<Graph, 'get' | 'apply'>
    report?: (error: unknown) => unknown
  },
  options: Options = {},
): Route[] => {
  let { receipts } = options
  if (!receipts) return []
  return [{
    method: 'POST',
    path: receipts.path ?? '/mail/resend',
    handle: async (request) => {
      try {
        if (!receipts.secret) {
          throw new Error('Resend webhook secret is not configured')
        }
        let arrived = await notification(request, receipts.secret)
        let ours = Object.entries(options.tags ?? {}).every(([key, value]) =>
          arrived.tags?.[key] == value
        )
        if (ours && arrived.receipt) {
          await receipted(host.graph, arrived.receipt)
        }
        return Response.json({ ok: true })
      } catch (error) {
        if (error instanceof Unsigned) {
          return Response.json({ error: error.message }, { status: 401 })
        }
        await host.report?.(error)
        return Response.json({ error: 'mail receipt is waiting' }, {
          status: 503,
        })
      }
    },
  }]
}
