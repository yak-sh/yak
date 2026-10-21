/**
 * The tally, as a duty: the module a server imports at `@yaks/spend/service`.
 * Every pass tallies today again from its requests (./day.ts), and yesterday
 * too for the first hours of a day, while its last requests are still being
 * read in; then it keeps the Claude plan's newest limits (./budget.ts). A
 * page that shows where the tokens went reads these rows, never the
 * requests, so looking costs nothing.
 *
 * It is a loop because a tally is owed as time passes, not when one write
 * commits: a day of requests is thousands of writes, and tallying after each
 * would cost more than the tally saves.
 *
 * @module
 */
import type { Graph } from '@yaks/graph'
import { sleep } from '@yaks/fp'
import { recompute } from './day.ts'
import { after, dayOf } from './window.ts'
import { read } from './budget.ts'

/** What a config can set for this duty. */
export type Options = {
  /** how long a pass waits for the next, in milliseconds (default ten
   * minutes) */
  every?: number
  /** where claude-status keeps its readings (default `$CLAUDE_USAGE_DIR` or
   * `~/.cache/claude-usage`) */
  usage?: string
}

/** How long a pass waits for the next. */
export let EVERY = 10 * 60 * 1000

/** How long into a day yesterday is tallied again. */
export let LATE = 3 * 60 * 60 * 1000

/** One pass: today, yesterday while it may still be arriving, the limits. */
export let pass = async (
  g: Graph,
  now: number = Date.now(),
  o: Options = {},
): Promise<void> => {
  let today = dayOf(now)
  if (now - Date.parse(`${today}T00:00:00Z`) < LATE) {
    await recompute(g, after(today, -1))
  }
  await recompute(g, today)
  // A day of the past week tallied before tallies kept their plans is
  // tallied again, so its week reads in plan shares too.
  let kept = await g.read(
    `.spend .spend.day>=${after(today, -8)} .fields=spend.day,spend.plans`,
  )
  for (let b of kept) {
    let s = b.spend as { day: string; plans?: unknown }
    if (!s.plans && s.day != today) await recompute(g, s.day)
  }
  await read(g, o.usage)
}

/** Tally, then again every `every`, until the signal aborts. An already
 * aborted signal is one pass. */
export let service = async (
  host: {
    graph: Graph
    report?: (
      error: unknown,
      context?: { tags?: Record<string, string> },
    ) => unknown
  },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
): Promise<void> => {
  for (;;) {
    try {
      await pass(host.graph, Date.now(), options)
    } catch (e) {
      // A pass that failed is told, and the next one tallies again.
      ;(host.report ?? console.error)(e, { tags: { step: 'spend pass' } })
    }
    if (signal.aborted) return
    await sleep(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
