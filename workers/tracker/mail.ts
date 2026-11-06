// An ordinary wake enables mail from its first activation onward. The stored
// date survives eviction; a trace wake never asks for this setup.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { configured, holding, type Options } from '@yaks/host/config'
import { lending, type Lends } from '@yaks/host/lending'
import { post as select } from '@yaks/mail'
import { platform } from './core.ts'
import { facets, post } from './config.ts'

export type Mailbox = {
  MAIL?: object
  MAIL_VIA?: string
  RESEND_WEBHOOK_SECRET?: string
  RESEND_TOKEN?: string
  RESEND_API?: string
  MAIL_FETCH?: (url: string, init: RequestInit) => Promise<Response>
  MAIL_FROM?: string
  MAIL_TO?: string
}

/** What the providers config.ts names lend of one kind, by name, their
 * options read from `env` with `add` beside them. */
export let lent = <K extends keyof Lends>(
  env: Mailbox,
  kind: K,
  add: Options = {},
): Readonly<Record<string, Lends[K]>> =>
  lending(
    configured(post, holding(env)).map(([plugin, options]) =>
      [facets[plugin], { ...options, ...add }, plugin] as const
    ),
    {},
    kind,
  ) ?? {}

/** The sender MAIL_VIA selects, else the binding, its letters tagged with
 * the tracker scope a provider's notice about them is routed back to. */
export let sender = (env: Mailbox, scope = platform) =>
  select({ via: env.MAIL_VIA ?? post.via }, {
    senders: lent(env, 'senders', { tags: { yak_tracker: scope } }),
  }).sender

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
