// Signed delivery receipts update the same neutral letter the sender wrote.
// A missing letter returns a retryable answer: an Operator may still be
// committing it when Resend calls back. Only the endpoint key authorizes this.
import type { Comp, Graph } from '@yaks/graph'
import type { Route } from '@yaks/api'
import { notification, Unsigned } from '@yaks/resend'

export type Options = {
  path?: string
  via?: string
  secret?: string
  tags?: Record<string, string>
}

let providers: Record<string, typeof notification> = { resend: notification }

export let receipts = (
  host: {
    graph: Pick<Graph, 'get' | 'apply'>
    report?: (error: unknown) => unknown
  },
  options: Options = {},
): Route[] => [{
  method: 'POST',
  path: options.path ?? '/mail/resend',
  handle: async (request) => {
    try {
      if (!options.secret) {
        throw new Error('Resend webhook secret is not configured')
      }
      let receive = providers[options.via ?? 'resend']
      if (!receive) throw new Error('No configured receipt receiver')
      let arrived = await receive(request, options.secret)
      if (
        Object.entries(options.tags ?? {}).some(([key, value]) =>
          arrived.tags?.[key] != value
        )
      ) return Response.json({ ok: true })
      let found = arrived.receipt
      if (!found) return Response.json({ ok: true })
      await receipted(host.graph, found)
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

/** Apply a provider-neutral receipt to the same recorded letter. */
export let receipted = async (
  graph: Pick<Graph, 'get' | 'apply'>,
  found: { letter: string; id: string },
): Promise<void> => {
  let [letter] = await graph.get([found.letter])
  if (!letter?.mail) {
    throw new Error('The delivery receipt awaits its recorded letter')
  }
  let prior = (letter.mail as Comp).message_id
  if (prior && prior != found.id) {
    throw new Error('The receipt disagrees with the recorded Message-ID')
  }
  if (!prior) {
    await graph.apply([{
      entity: letter.entity,
      mail: { message_id: found.id },
    }], { trusted: true })
  }
}
