// The independent Worker only routes authenticated reads/RPC and trusted queue
// deliveries. It has no directory or yak binding; intake needs no auth lookup.

import type { Bundle } from '@yaks/graph'
import { caught, queue } from '@yaks/tracker/report'
import { platform } from './core.ts'
import { consume, type Message } from './queue.ts'
import { json } from './door.ts'
import type { Settings } from './object.ts'

export type Stub = {
  fetch: (request: Request) => Promise<Response>
  ingest: (rows: Bundle[]) => Promise<void>
  monitor: () => Promise<void>
}
export type Env = Settings & {
  TRACKERS: { getByName: (scope: string) => Stub }
}
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export let scopeOf = (request: Request) => {
  let url = new URL(request.url)
  let scope = url.searchParams.get('scope')
  return scope == 'platform'
    ? platform
    : scope && uuid.test(scope)
    ? scope
    : null
}
export let worker = (env: Env) => ({
  fetch: async (request: Request): Promise<Response> => {
    let scope = scopeOf(request)
    if (!scope) return json({ error: 'tracker global scope required' }, 400)
    try {
      return await env.TRACKERS.getByName(scope).fetch(request)
    } catch (error) {
      await caught(error, { sink: env.ERRORS ? queue(env.ERRORS) : () => {} })
      return json({ error: 'tracker temporarily unavailable' }, 503)
    }
  },
  queue: (messages: Message[]) =>
    consume(
      messages,
      (scope) => env.TRACKERS.getByName(scope),
      (error) =>
        caught(error, { sink: env.ERRORS ? queue(env.ERRORS) : () => {} }),
    ),
  scheduled: () => env.TRACKERS.getByName(platform).monitor(),
})
