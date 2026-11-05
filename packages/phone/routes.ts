// The `@yaks/phone/routes` facet: the door a box's provider posts to, reached
// from outside through the box's Cloudflare tunnel like any other inbound
// request. Events are decoded only after @yaks/hook verifies the provider.

import type { Graph } from '@yaks/graph'
import { fault, json, refuse, type Route } from '@yaks/api'
import { Refused } from '@yaks/graph/errors'
import type { Options } from './options.ts'
import { kept, settled } from './received.ts'
import { listens, type Load, provider, verified } from './provider.ts'

/** `POST /<via>/webhook`: one verified provider event. A missing or stale
 * signature is refused quietly; one that is complete and does not match,
 * which is what a wrong key looks like, is refused and reported. */
export let routes = (
  host: { graph: Graph },
  options: Options = {},
  load: Load = provider,
): Route[] =>
  options.door
    ? [{
      method: 'POST',
      path: options.door.path ??
        `/${options.door.via ?? options.sender?.via ?? 'telnyx'}/webhook`,
      handle: async (request) => {
        let via = options.door!.via ?? options.sender?.via ?? 'telnyx'
        let transport = (await load(via)).provider
        if (!listens(transport)) {
          throw new Error(`${via} has no verified webhook door`)
        }
        let said = await verified(transport, options.door!.key, request)
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
              `.text.via=${via}&.text.message_id=${JSON.stringify(outcome.id)}`,
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
