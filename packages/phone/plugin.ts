// What a provider package is built from to be a plugin a config names beside
// @yaks/phone: the texter it lends its host under its own name, and the
// webhook door its provider posts to. Phone implements both once; a provider
// gives its `Provider` as data, and phone never names one.
//
// ```json
// [ { "use": "@yaks/pinnacle",
//     "with": { "key": { "secret": "PINNACLE_API_KEY" },
//               "number": "+12695550100",
//               "door": { "key": { "secret": "PINNACLE_SIGNING_SECRET" } } } },
//   { "use": "@yaks/phone", "with": { "sender": { "via": "pinnacle" } } } ]
// ```

import type { Graph } from '@yaks/graph'
import { fault, json, refuse, type Route } from '@yaks/api'
import { Refused } from '@yaks/graph/errors'
import type { Transport } from './options.ts'
import { kept, settled } from './received.ts'
import { listens, type Provider, sender, verified } from './provider.ts'
import type { Texter } from '@yaks/host/senders'

/** The webhook door: where the provider posts, and the key that verifies it. */
export type Door = {
  /** defaults to /<via>/webhook */
  path?: string
  key: string
}

/** What a config passes to a provider plugin: its transport's settings and
 * credentials, and its door when it takes webhooks. Secrets are resolved by
 * the host, and read at every text. */
export type Lent = Omit<Transport, 'via'> & { door?: Door }

/** The texter a provider lends as `via`, built from the options at every
 * text, so a secret set after start-up is used for the next one. Until the
 * options carry what the provider `needs`, it is waiting. */
export let lent = (
  via: string,
  provider: Provider,
  options: Lent = {},
): Texter => {
  let transport = (): Transport => ({ ...options, via })
  let missing = () => provider.needs?.filter((key) => !transport()[key]) ?? []
  return {
    send: (text) => sender(transport(), provider).send(text),
    waiting: () =>
      missing().length
        ? `waiting for credentials: a ${via} sender needs ${
          missing().join(', ')
        }`
        : undefined,
  }
}

/** A provider plugin's graph facet, lending its texter by name. */
export type Texters = (
  host: unknown,
  options?: Lent,
) => Record<string, Texter>

/** A provider plugin's routes facet, its webhook door. */
export type Routes = (host: { graph: Graph }, options?: Lent) => Route[]

/** The graph facet of the provider plugin `via`: `texters(host, options)`
 * lends its texter under that name. */
export let texters =
  (via: string, provider: Provider): Texters => (_host, options = {}) => ({
    [via]: lent(via, provider, options),
  })

/** A provider plugin's routes facet: `POST /<via>/webhook`, one verified
 * provider event, where the options name a door. A missing or stale
 * signature is refused quietly; one that is complete and does not match,
 * which is what a wrong key looks like, is refused and reported. */
export let routes =
  (via: string, provider: Provider): Routes => (host, options = {}) =>
    options.door && listens(provider)
      ? [{
        method: 'POST',
        path: options.door.path ?? `/${via}/webhook`,
        handle: async (request) => {
          let said = await verified(provider, options.door!.key, request)
          if ('refused' in said) {
            if (said.ours) {
              fault(
                new Error(said.refused),
                `POST ${new URL(request.url).pathname}`,
              )
            }
            return refuse(
              new Refused(`not signed by ${via}: ${said.refused}`),
              request,
            )
          }
          try {
            let { arrival, outcome } = said.heard
            let g = host.graph
            if (arrival) {
              let people = await g.read(
                `.phone.number=${JSON.stringify(arrival.from)}`,
              )
              await g.apply(
                kept({ ...arrival, via }, people.map((p) => p.entity.eid)),
              )
            }
            if (outcome) {
              let [sent] = await g.read(
                `.text.via=${via}&.text.message_id=${
                  JSON.stringify(outcome.id)
                }`,
              )
              if (sent) {
                await g.apply(settled(outcome, sent.entity.eid), {
                  trusted: true,
                })
              }
            }
            return json({})
          } catch (error) {
            return refuse(error, request)
          }
        },
      }]
      : []
