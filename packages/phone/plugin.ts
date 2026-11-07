// What a provider package is built from to be a plugin a config names beside
// @yaks/phone: the phone it lends its host under its own name, a texter
// with the provider's webhook and calls beside it, and the webhook door its
// provider posts to. Phone implements both once; a provider gives its
// `Provider` as data, and phone never names one.
//
// ```json
// [ { "use": "@yaks/pinnacle",
//     "with": { "key": { "secret": "PINNACLE_API_KEY" },
//               "number": "+12695550100",
//               "door": { "key": { "secret": "PINNACLE_SIGNING_SECRET" } } } },
//   { "use": "@yaks/phone", "with": { "sender": { "via": "pinnacle" } } } ]
// ```

import type { Graph } from '@yaks/graph'
import type { Route } from '@yaks/api'
import { fault, json, refuse } from '@yaks/api/refuse'
import { Refused } from '@yaks/graph/errors'
import type { Transport } from './options.ts'
import { kept, settled } from './received.ts'
import {
  type Heard,
  listens,
  type Own,
  type Provider,
  sender,
  verified,
} from './provider.ts'
import type { Caller, Line } from './call.ts'
import type { Numbers } from './numbers.ts'
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

/** What a provider's webhook said once its door read it: what it heard, or
 * why it was refused (`verified`). */
export type Said = Awaited<ReturnType<typeof verified>>

/** A provider as its plugin lends it under its name: a texter to any host,
 * and the rest of what the provider offers. Each part is built from the
 * plugin's options at its use, so a secret set after start-up is used by
 * the next. */
export type Phone = Texter & {
  /** the transport its options make now, `via` its name */
  transport: () => Transport
  /** the number it texts from when a text names none: its options', else
   * the one the provider picks, where it can say */
  from: () => Promise<string | undefined>
  /** the same phone with `more` laid over its options, such as a number of
   * its own */
  over: (more: Partial<Lent>) => Phone
  /** a request to its webhook, verified with its door's key; undefined
   * where it has no door or takes no webhooks */
  hear: (request: Request) => Promise<Said | undefined>
  /** what it is asked to do with calls, where it takes them */
  caller?: () => Caller
  /** the wire its calls' audio streams over, where it takes them */
  line?: Line
  /** how a person connects a number of their own through it, where it
   * offers that: their account opens with their own settings alone */
  own?: Own
  /** the numbers it sells, on the account it texts through, where it
   * sells them */
  numbers?: () => Numbers
}

let phone = (via: string, provider: Provider, options: () => Lent): Phone => {
  let transport = (): Transport => ({ ...options(), via })
  let missing = () => provider.needs?.filter((key) => !transport()[key]) ?? []
  let made = () => sender(transport(), provider)
  return {
    transport,
    send: (text) => made().send(text),
    from: () => made().from?.() ?? Promise.resolve(undefined),
    waiting: () =>
      missing().length
        ? `waiting for credentials: a ${via} sender needs ${
          missing().join(', ')
        }`
        : undefined,
    over: (more) => phone(via, provider, () => ({ ...options(), ...more })),
    hear: async (request) => {
      let key = options().door?.key
      return key && listens(provider)
        ? await verified(provider, key, request)
        : undefined
    },
    ...provider.caller ? { caller: () => provider.caller!(transport()) } : {},
    ...provider.line ? { line: provider.line } : {},
    ...provider.own ? { own: provider.own } : {},
    ...provider.numbers
      ? { numbers: () => provider.numbers!(transport()) }
      : {},
  }
}

/** The phone a provider lends as `via`. Until its options carry what the
 * provider `needs`, it is waiting. */
export let lent = (
  via: string,
  provider: Provider,
  options: Lent = {},
): Phone => phone(via, provider, () => options)

/** A provider plugin's graph facet, lending its phone by name. */
export type Texters = (
  host: unknown,
  options?: Lent,
) => Record<string, Phone>

/** A provider plugin's routes facet, its webhook door. */
export type Routes = (host: { graph: Graph }, options?: Lent) => Route[]

/** The graph facet of the provider plugin `via`: `texters(host, options)`
 * lends its phone under that name. */
export let texters =
  (via: string, provider: Provider): Texters => (_host, options = {}) => ({
    [via]: lent(via, provider, options),
  })

// What a door keeps of what its provider said: a text that arrived, from
// whoever here wears its number, and a sent text's later failure.
let keep = async (graph: Graph, via: string, heard: Heard): Promise<void> => {
  let { arrival, outcome } = heard
  if (arrival) {
    let people = await graph.read(
      `.phone.number=${JSON.stringify(arrival.from)}`,
    )
    await graph.apply(
      kept({ ...arrival, via }, people.map((p) => p.entity.eid)),
    )
  }
  if (outcome) {
    let [sent] = await graph.read(
      `.text.via=${via}&.text.message_id=${JSON.stringify(outcome.id)}`,
    )
    if (sent) {
      await graph.apply(settled(outcome, sent.entity.eid), { trusted: true })
    }
  }
}

// Two strings compared in time that says nothing of where they differ.
let same = (a: string, b: string): boolean => {
  let x = new TextEncoder().encode(a)
  let y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  }
  return diff == 0
}

/** A provider plugin's routes facet, where the options name a door. A
 * provider that signs its webhooks is posted to at `POST /<via>/webhook`: a
 * missing or stale signature is refused quietly; one that is complete and
 * does not match, which is what a wrong key looks like, is refused and
 * reported. One whose texts arrive by a callback URL it signs nothing on
 * (its `own.called`, voip.ms's) is called at `GET /<via>/<key>?<query>`, the
 * door's key in the path being what says the call is the provider's; the
 * host points the number's callback there, with `own.callback` as its
 * query. */
export let routes =
  (via: string, provider: Provider): Routes => (host, options = {}) => {
    let door = options.door
    if (door && listens(provider)) {
      return [{
        method: 'POST',
        path: door.path ?? `/${via}/webhook`,
        handle: async (request) => {
          let said = await verified(provider, door.key, request)
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
            await keep(host.graph, via, said.heard)
            return json({})
          } catch (error) {
            return refuse(error, request)
          }
        },
      }]
    }
    let called = provider.own?.called
    if (!door || !called) return []
    let base = door.path ?? `/${via}`
    return [{
      method: 'GET',
      path: `${base}/*`,
      handle: async (request) => {
        let url = new URL(request.url)
        let key = decodeURIComponent(url.pathname.slice(base.length + 1))
        if (!door.key || !same(key, door.key)) {
          return new Response('not ours', { status: 403 })
        }
        try {
          let arrival = called(url.searchParams)
          if (arrival) await keep(host.graph, via, { arrival })
          return new Response('ok', {
            headers: { 'content-type': 'text/plain' },
          })
        } catch (error) {
          return refuse(error, request)
        }
      },
    }]
  }
