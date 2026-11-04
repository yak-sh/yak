// The `@yaks/phone/routes` facet: the door a box's provider posts to, reached
// from outside through the box's Cloudflare tunnel like any other inbound
// request. Nothing is read until @yaks/hook finds it signed by Telnyx.

import type { Graph } from '@yaks/graph'
import { fault, json, refuse, type Route } from '@yaks/api'
import { Refused } from '@yaks/graph/errors'
import { ours, refusal } from '@yaks/hook'
import type { Options } from './options.ts'
import { kept, settled } from './received.ts'
import { heard } from './telnyx.ts'

/** The path texts arrive on, unless the config sets another. */
export let PATH = '/telnyx/webhook'

/** `POST /telnyx/webhook`: one event, signed by Telnyx. A missing or stale
 * signature is refused quietly; one that is complete and does not match,
 * which is what a wrong key looks like, is refused and reported. */
export let routes = (
  host: { graph: Graph },
  options: Options = {},
): Route[] =>
  options.door
    ? [{
      method: 'POST',
      path: options.door.path ?? PATH,
      handle: async (request) => {
        let body = await request.text()
        let why = await refusal(
          'telnyx',
          options.door!.key,
          body,
          request.headers,
        )
        if (why) {
          if (ours(why)) {
            fault(new Error(why), `POST ${new URL(request.url).pathname}`)
          }
          return refuse(
            new Refused(`not signed by Telnyx: ${why}`),
            request,
          )
        }
        try {
          let { arrival, outcome } = heard(JSON.parse(body))
          let g = host.graph
          if (arrival) {
            let [person] = await g.read(
              `.phone.number=${JSON.stringify(arrival.from)}`,
            )
            await g.apply(kept(arrival, person?.entity.eid ?? null))
          }
          if (outcome) {
            let [sent] = await g.read(
              `.text.message_id=${JSON.stringify(outcome.id)}`,
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
