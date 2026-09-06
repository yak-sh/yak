// The tool list a client is holding, and what a result says about it.
//
// A CLI lists once and caches (store.ts), because listing on every command
// would double the round trips this program exists to make cheap. That leaves
// the question the ROSTER answers (@yaks/mcp `roster.ts`, T-34277): is the list
// I am holding still the list? Two things say so and both arrive for free —
// a result carrying the server's roster line, and an `about` naming a version
// this cache is not stamped with. Nothing here ASKS: asking costs the trip.
//
// The roster line is also not the tool's own words. It is news about this
// program, so `saidBy` lifts it out of the answer: the caller prints it on
// stderr and stdout stays exactly what was asked for.

import type { Roster } from './store.ts'

/** A tool result, as far as this client reads one. */
export type Result = {
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

/** @yaks/mcp's roster line, by the words it opens with. */
export let STALE = 'The tool list changed since you connected'

/** What the tool said, and the news the server slipped in beside it. */
export let saidBy = (out: Result): { text: string; stale?: string } => {
  let blocks = (out.content ?? []).map((c) => c.text ?? `[${c.type}]`)
  let stale = blocks.find((b) => b.startsWith(STALE))
  return {
    text: blocks.filter((b) => b != stale).join('\n'),
    ...(stale ? { stale } : {}),
  }
}

/** The roster version an `about` answer names (workers/yak `tools.ts`). */
export let versionIn = (text: string): string | undefined =>
  /\broster ([0-9a-f]{8})\b/.exec(text)?.[1]

/**
 * The roster to hold after a result: the same one, one stamped with the
 * version `about` just named, or `null` — drop it and list again.
 *
 * ```ts
 * rosterAfter({ tools: [] }, 'about', { text: 'roster 1a2b3c4d' })
 * // { tools: [], version: '1a2b3c4d' }
 * ```
 */
export let rosterAfter = (
  roster: Roster,
  name: string,
  said: { text: string; stale?: string },
): Roster | null => {
  if (said.stale) return null
  let seen = name == 'about' ? versionIn(said.text) : undefined
  if (!seen) return roster
  if (!roster.version) return { ...roster, version: seen }
  return roster.version == seen ? roster : null
}
