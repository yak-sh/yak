// The browser's private sign-in door uses the same integration authorization
// as yak auth. Return URLs go straight to the vault, never into a tool call.
import { readBody, type Route } from '@yaks/api'
import { authorize } from '@yaks/connections'
import { Refused } from '@yaks/graph/errors'
import { person } from '@yaks/cli/config'
import type { Vault } from '@yaks/secrets'
import type { Hosting } from './routes.ts'

export let authorization = (host: Hosting & { vault: Vault }): Route => {
  let auth: ReturnType<typeof authorize> | undefined
  host.stopping?.addEventListener('abort', () => void auth?.close(), {
    once: true,
  })
  return {
    method: 'POST',
    path: '/web/authorize',
    handle: async (request) => {
      await host.who?.(request)
      let origin = request.headers.get('origin')
      if (origin && origin != new URL(request.url).origin) {
        throw new Refused('Sign in from this site')
      }
      if (!request.headers.get('content-type')?.includes('application/json')) {
        throw new Refused('Expected a JSON authorization request')
      }
      let { action, name, callback } = JSON.parse(await readBody(request))
      if (!['list', 'begin', 'complete', 'cancel'].includes(action)) {
        throw new Refused('Unknown authorization action')
      }
      if (
        name != null && typeof name != 'string' ||
        callback != null && typeof callback != 'string'
      ) {
        throw new Refused('Name and return URL must be text')
      }
      auth ??= authorize({
        graph: host.graph,
        vault: host.vault,
        owner: await person({ graph: host.graph, config: host.config ?? {} }),
      })
      return Response.json(await auth.run(action, name, callback), {
        headers: { 'cache-control': 'no-store' },
      })
    },
  }
}
