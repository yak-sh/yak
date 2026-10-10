// An ordinary wake enables mail from its first activation onward. The stored
// date survives eviction; a trace wake never asks for this setup.
import type { Bundle, Graph } from '@yaks/graph'
import { platform } from './core.ts'

export type Mailbox = {
  MAIL?: unknown
  MAIL_FROM?: string
  MAIL_TO?: string
}

export let activation = (
  scope: string,
  env: Mailbox,
  since: string | undefined,
  now: () => number,
): { recipient?: Bundle; to?: string; from?: string; since?: string } => {
  if (scope != platform) return {}
  return {
    ...env.MAIL_TO
      ? {
        recipient: {
          entity: { eid: platform },
          email: { address: env.MAIL_TO },
        },
      }
      : {},
    ...env.MAIL && env.MAIL_FROM && env.MAIL_TO
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
  graph: Pick<Graph, 'apply'>,
  scope: string,
  env: Mailbox,
  keeping: () => Kept,
  now: () => number,
) => {
  let enabled = scope == platform && env.MAIL && env.MAIL_FROM && env.MAIL_TO
  let kept = enabled ? keeping() : undefined
  let since = kept?.get('mail-since')
  let { recipient, ...config } = activation(scope, env, since, now)
  if (recipient) await graph.apply([recipient], { trusted: true })
  if (config.since && !since) kept!.set('mail-since', config.since)
  return config
}
