// Cron failures are occurrences, not a second monitor state machine. A stored
// heartbeat and the upstream probes resolve on recovery through tracker marks.

import type { TrackerStore } from './core.ts'
import { capture, type Context, origin } from '@yaks/tracker/report'
import { derivedEid } from '@yaks/graph/identity'
import { and, eq, fields } from '@yaks/query'

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

export let heartbeat = derivedEid('tracker|box-heartbeat')
export let monitor = async (
  tracker: TrackerStore,
  last: number | undefined,
  send: typeof fetch = fetch,
  now = Date.now(),
  context: Pick<Context, 'tags' | 'commit' | 'during' | 'request'> = origin(
    'yak-tracker',
    undefined,
    'Tracker.monitor',
  ),
) => {
  let fault = 'tracker|platform-uptime'
  let broken = (await Promise.all(PROBES.map((door) => probe(send, door))))
    .filter(Boolean).join('; ')
  // A probe that passes again resolves its outage, saying so: nobody looked
  // into why it failed, and the next failure is caught the same way.
  let check = async (key: string, reason: string, back: string) => {
    if (reason) {
      await tracker.ingest(capture(Error(reason), {
        sink: () => {},
        ...context,
        level: 'fatal',
        fault: key,
        at: new Date(now).toISOString(),
      }))
    } else {
      let bugs = await tracker.graph.read(and(
        eq('bug.fault', key),
        eq('bug.status', 'open'),
        fields('entity.eid'),
      ))
      for (let bug of bugs) {
        await tracker.mark(bug.entity.eid, 'resolved', {
          cause: `Not investigated: ${back} at ${
            new Date(now).toISOString()
          }, so the outage ended.`,
          recur: 'It can: the next failed check is recorded on this bug.',
        })
      }
    }
  }
  await check(fault, broken, 'every probed door of yaks.app answered again')
  // No heartbeat yet means the box reporter is not activated, not a failure.
  if (last != null) {
    await check(
      'tracker|box-heartbeat',
      now - last > 300_000 ? 'Box heartbeat overdue' : '',
      "the box's heartbeat arrived again",
    )
  }
}
