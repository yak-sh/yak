// Cron failures are occurrences, not a second monitor state machine. A door
// or heartbeat that is healthy again resolves nothing: a failure stays open,
// and keeps reaching agents, until one fixes its cause and resolves it
// (M-37965). Its last occurrence says when it stopped.

import type { TrackerStore } from './core.ts'
import { capture, type Context, origin } from '@yaks/tracker/report'

/** A door of yaks.app the cron asks each minute, and the status it answers
 * when it serves. */
export type Probe = { name: string; url: string; status: number }

// The connector's door answers before any store is asked, and asks a caller
// with no session to sign in. An app's `api/me` reads its app row from the
// directory on every request (workers/yak directory.ts) and wakes no app
// store, so it fails when the directory stalls, which holds every page and
// tool waiting with it. Its `api/query` wakes the app's store and reads it in
// the grammar its pages write. The home page is the door a stranger comes to,
// and it has hung with the others answering.
export let PROBES: Probe[] = [
  { name: 'home', url: 'https://yaks.app/', status: 200 },
  { name: 'MCP', url: 'https://yaks.app/mcp', status: 401 },
  { name: 'app', url: 'https://yourname.yaks.app/recipes/api/me', status: 200 },
  {
    name: 'query',
    url: 'https://yourname.yaks.app/recipes/api/query?.recipe&.limit=1',
    status: 200,
  },
]

// How long a door may take to answer before it counts as down: a hang sends
// no bytes and throws nothing, so only a deadline sees it.
let PATIENCE = 10_000

/** Why one door is down, or '' when it answered as it does when it serves.
 * Any other status is a failure: a 4xx says the door refuses what its
 * callers send, as surely as a 5xx says it cannot serve. */
let probe = async (send: typeof fetch, { name, url, status }: Probe) => {
  try {
    let response = await send(url, {
      method: 'GET',
      signal: AbortSignal.timeout(PATIENCE),
      redirect: 'manual',
    })
    await response.body?.cancel()
    return response.status != status
      ? `${name} probe: ${response.status} from ${url}`
      : ''
  } catch (error) {
    return error instanceof Error && error.name == 'TimeoutError'
      ? `${name} probe: no answer within ${PATIENCE / 1000} s from ${url}`
      : `${name} probe unavailable: ${url}`
  }
}

/** Each door's failures group as a bug of its own: the connector's door asks
 * no store, and an app's asks the directory, so they fail for different
 * reasons. */
export let uptime = (door: Probe) => `tracker|platform-uptime|${door.name}`
export let monitor = async (
  tracker: Pick<TrackerStore, 'ingest'>,
  last: number | undefined,
  send: typeof fetch = fetch,
  now = Date.now(),
  context: Pick<Context, 'tags' | 'commit' | 'during' | 'request'> = origin(
    'yak-tracker',
    undefined,
    'Tracker.monitor',
  ),
) => {
  let failed = (fault: string, reason: string) =>
    tracker.ingest(capture(Error(reason), {
      sink: () => {},
      ...context,
      level: 'fatal',
      fault,
      at: new Date(now).toISOString(),
    }))
  let reasons = await Promise.all(PROBES.map((door) => probe(send, door)))
  for (let [i, reason] of reasons.entries()) {
    if (reason) await failed(uptime(PROBES[i]), reason)
  }
  // No heartbeat yet means the box reporter is not activated, not a failure.
  if (last != null && now - last > 300_000) {
    await failed('tracker|box-heartbeat', 'Box heartbeat overdue')
  }
}
