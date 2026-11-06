// An ordinary wake enables mail from its first activation onward. The stored
// date survives eviction; a trace wake never asks for this setup.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { post } from '@yaks/mail'
import { type Binding, bound } from '@yaks/cloudflare-mail/binding'
import { configured as resend } from '@yaks/resend/sender'
import { platform } from './core.ts'

export type Mailbox = {
  MAIL?: Binding
  MAIL_VIA?: string
  RESEND_WEBHOOK_SECRET?: string
  RESEND_TOKEN?: string
  RESEND_API?: string
  MAIL_FETCH?: import('@yaks/cloudflare-mail').Fetch
  MAIL_FROM?: string
  MAIL_TO?: string
}

export let sender = (env: Mailbox, scope = platform) => {
  let via = env.MAIL_VIA ?? 'binding'
  return (via == 'resend'
    ? resend({
      tags: { yak_tracker: scope },
      token: env.RESEND_TOKEN,
      base: env.RESEND_API,
      fetch: env.MAIL_FETCH,
    })
    : post({ via }, { senders: env.MAIL ? { binding: bound(env.MAIL) } : {} }))
    .sender
}

let enabled = (env: Mailbox) => !!(sender(env) && env.MAIL_FROM && env.MAIL_TO)

export let activation = (
  env: Mailbox,
  since: string | undefined,
  now: () => number,
): { recipient?: Bundle; to?: string; from?: string; since?: string } => {
  return {
    ...env.MAIL_TO
      ? {
        recipient: {
          entity: { eid: platform },
          email: { address: env.MAIL_TO },
        },
      }
      : {},
    ...enabled(env)
      ? {
        to: platform,
        from: env.MAIL_FROM,
        since: since || new Date(now()).toISOString(),
      }
      : {},
  }
}

type Kept = {
  get: (key: string) => string | undefined
  set: (key: string, value: string) => void
}

export let activate = async (
  graph: Pick<Graph, 'apply' | 'get'>,
  env: Mailbox,
  keeping: () => Kept,
  now: () => number,
) => {
  let kept = enabled(env) ? keeping() : undefined
  let since = kept?.get('mail-since')
  let { recipient, ...config } = activation(env, since, now)
  if (recipient) {
    let [held] = await graph.get([recipient.entity.eid], ['email'])
    if ((held?.email as Comp | undefined)?.address != env.MAIL_TO) {
      await graph.apply([recipient], { trusted: true })
    }
  }
  if (config.since && !since) kept!.set('mail-since', config.since)
  return config
}
