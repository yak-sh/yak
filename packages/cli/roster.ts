// The tool list a client is holding, and what a tool result tells it about
// that list.
//
// The CLI calls `tools/list` once and caches the result (store.ts), because
// listing on every command would double the round trips this program exists to
// make cheap. That leaves one question, which the ROSTER answers (@yaks/mcp
// `roster.ts`, T-34277): is the list I am holding still current? Two signals
// answer it and both arrive for free — a tool result carrying the server's
// roster notice, and an `about` result naming a version this cache is not
// stamped with. Nothing here asks the server on purpose: asking costs a round
// trip.
//
// The roster notice is also not part of the tool's own output. It is news
// about this program, so `saidBy` separates it from the result: the caller
// prints it on stderr and stdout stays exactly what was asked for.

import type { Roster } from './store.ts'

/** A tool result, as much of it as this client reads. */
export type Result = {
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

/** How @yaks/mcp's roster notice begins, which is how it is recognized. */
export let STALE = 'The tool list changed since you connected'

/** The tool's own output, and the roster notice the server added beside
 * it. */
export let saidBy = (out: Result): { text: string; stale?: string } => {
  let blocks = (out.content ?? []).map((c) => c.text ?? `[${c.type}]`)
  let stale = blocks.find((b) => b.startsWith(STALE))
  return {
    text: blocks.filter((b) => b != stale).join('\n'),
    ...(stale ? { stale } : {}),
  }
}

/** The roster version an `about` result names (workers/yak `tools.ts`). */
export let versionIn = (text: string): string | undefined =>
  /\broster ([0-9a-f]{8})\b/.exec(text)?.[1]

/**
 * The roster to keep after a result: the same one, the same one stamped with
 * the version `about` just named, or `null` — drop the cache and call
 * `tools/list` again.
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
