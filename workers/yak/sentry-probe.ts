// A workerd probe of the same caught-defect path the kernel wraps in index.ts.
// Its DSN points at the test's local capture server (probe.ts).
// @ts-types="./sentry.d.ts"
import {
  instrumentDurableObjectWithSentry,
  withSentry,
} from '@sentry/cloudflare'
import type { Namespace } from './door.ts'
import { defect, options } from './sentry.ts'

export let Probe = instrumentDurableObjectWithSentry(
  options,
  class Probe {
    fetch(req: Request): Response {
      defect(new Error('durable object sentry probe'), {
        request: 'GET /query',
        request_id: new URL(req.url).pathname.split('/').pop(),
      })
      return new Response('caught in object', { status: 500 })
    }
  },
)

export default withSentry(options, {
  fetch(req: Request, env: { PROBE: Namespace }): Response | Promise<Response> {
    if (new URL(req.url).pathname.startsWith('/__sentry/do/')) {
      return env.PROBE.get(env.PROBE.idFromName('probe')).fetch(req)
    }
    defect(new Error('sentry probe'), {
      request: 'GET /api/vocab.json',
      request_id: new URL(req.url).pathname.split('/').pop(),
    })
    return new Response('caught', { status: 500 })
  },
})
