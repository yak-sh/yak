// Cron failures are occurrences, not a second monitor state machine. A door
// or heartbeat that is healthy again resolves nothing: a failure stays open,
// and keeps reaching agents, until one finds its cause and resolves it, or
// judges it a one-off (M-37965). Its last occurrence says when it stopped.

import type { TrackerStore } from './core.ts'
import { capture, type Context, origin } from '@yaks/tracker/report'

/** A door of yaks.app the cron asks each minute. */
export type Probe = { name: string; url: string }

// The connector's door answers before any store is asked. An app's `api/me`
// reads its app row from the directory on every request (workers/yak
// directory.ts) and wakes no app store, so it fails when the directory
// stalls, which holds every page and tool waiting with it.
export let PROBES: Probe[] = [
  { name: 'MCP', url: 'https://yaks.app/mcp' },
  { name: 'app', url: 'https://yourname.yaks.app/recipes/api/me' },
]

// How long a door may take to answer before it counts as down: a hang sends
// no bytes and throws nothing, so only a deadline sees it.
let PATIENCE = 10_000

/** Why one door is down, or '' when it answered. A GET without a session may
 * answer 400 or 405; server errors and missing routes mean it cannot serve. */
let probe = async (send: typeof fetch, { name, url }: Probe) => {
  try {
    let response = await send(url, {
      method: 'GET',
      signal: AbortSignal.timeout(PATIENCE),
      redirect: 'manual',
    })
    await response.body?.cancel()
    return response.status >= 500 || response.status == 404
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
