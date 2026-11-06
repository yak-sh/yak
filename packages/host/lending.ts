// What plugins lend a host by name, beside what the host lends itself: mail
// senders, texters and embedders, which a graph host passes on
// (Host.senders, Host.texters, Host.embedders), and a provider's notice and
// arrival readers and a payment provider (./payments.ts), which a host that
// routes mail or takes money itself asks for, such as a Worker naming its
// providers in config. One party per name: a letter or a vector made through a name two
// parties answer to would depend on order.
import { CallError } from '@yaks/tools/errors'
import type { Embedding, Host } from './mod.ts'
import type { Arrival, Notices, Sender, Texter } from './senders.ts'
import type { Payments } from './payments.ts'
import type { Taken } from './words.ts'

/** What each kind of loan is. */
export type Lends = {
  senders: Sender
  texters: Texter
  embedders: Embedding
  notices: Notices
  arrivals: Arrival
  payments: Payments
}

/** The loans of one kind the graph facets make, beside the host's own
 * `lent`, or `lent` itself where no plugin makes one. A name lent twice is
 * refused.
 *
 * ```ts
 * import { lending } from '@yaks/host/lending'
 * import { equal, throws } from '@yaks/testing'
 *
 * let sender = { send: () => Promise.resolve({}) }
 * let lends = { senders: () => ({ post: sender }) }
 * equal(Object.keys(lending([[lends, {}, '@a/post']], {}, 'senders')!), ['post'])
 * throws(
 *   () => lending([[lends, {}, '@a/post']], {}, 'senders', { post: sender }),
 *   'the sender post is lent by both the host and @a/post',
 * )
 * ```
 */
export let lending = <K extends keyof Lends>(
  graphs: Taken<'graph'>,
  host: Partial<Host>,
  kind: K,
  lent?: Readonly<Record<string, Lends[K]>>,
): Readonly<Record<string, Lends[K]>> | undefined => {
  let what = kind.slice(0, -1)
  let by = new Map(Object.keys(lent ?? {}).map((name) => [name, 'the host']))
  let all: Record<string, Lends[K]> = { ...lent }
  for (let [r, options, plugin] of graphs) {
    let made = r[kind]?.(host as Host, options) as
      | Record<string, Lends[K]>
      | undefined
    for (let [name, one] of Object.entries(made ?? {})) {
      if (by.has(name)) {
        throw new CallError(
          'config',
          `the ${what} ${name} is lent by both ${by.get(name)} and ${plugin}`,
        )
      }
      by.set(name, plugin)
      all[name] = one
    }
  }
  return by.size ? all : lent
}
