// Cron failures are occurrences, not a second monitor state machine. A stored
// heartbeat and the upstream probe resolve on recovery through tracker marks.

import type { TrackerStore } from './core.ts'
import { capture, type Context, origin } from '@yaks/tracker/report'
import { derivedEid } from '@yaks/graph/identity'
import { and, eq, fields } from '@yaks/query'

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
  let broken = ''
  try {
    let response = await send('https://yaks.app/mcp', {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    })
    // An MCP GET without a session may answer 400 or 405. Server errors and
    // unavailable routes mean the endpoint itself cannot serve.
    if (response.status >= 500 || response.status == 404) {
      broken = `MCP probe: ${response.status}`
    }
    await response.body?.cancel()
  } catch {
    broken = 'MCP probe unavailable'
  }
  let check = async (key: string, reason: string) => {
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
      for (let bug of bugs) await tracker.mark(bug.entity.eid, 'resolved')
    }
  }
  await check(fault, broken)
  // No heartbeat yet means the box reporter is not activated, not a failure.
  if (last != null) {
    await check(
      'tracker|box-heartbeat',
      now - last > 300_000 ? 'Box heartbeat overdue' : '',
    )
  }
}
