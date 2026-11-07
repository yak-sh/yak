// The search tool's answer: the words' text hits and their meaning's, ranked
// together and said one line a row. Each half reads the store alone, so a
// host reading through two lanes runs them at once (./read_thread.ts), and
// the rows they rank are read and said where they are read: text a line
// never shows is never copied out, nor its read token hashed.

import type { Bundle } from '@yaks/graph'
import type { Search } from '@yaks/graph/tools'
import type { Hit } from '@yaks/fts'
import type { MeaningHit } from '@yaks/host'

/** What the two halves found for some words. */
export type Found = { words: Hit[]; meaning: MeaningHit[] }

/** A search from how its halves find, each asked for `count`, and how the
 * best `limit` of what they found are said.
 *
 * ```ts
 * import { searching } from './searching.ts'
 * import { equal } from '@yaks/testing'
 *
 * let asked: number[] = []
 * let search = searching(
 *   (_, count) => (asked.push(count), Promise.resolve({ words: [], meaning: [] })),
 *   (_, __, limit) => Promise.resolve([{ entity: { eid: `${limit}` } }]),
 * )
 * equal(await search('mossvale', { limit: 300 }), [{ entity: { eid: '100' } }])
 * equal(await search('mossvale', { limit: 0 }), [])
 * equal(asked, [200])
 * ```
 */
export let searching = (
  find: (words: string, count: number) => Promise<Found>,
  say: (words: string, found: Found, limit: number) => Promise<Bundle[]>,
): Search =>
async (words, opts) => {
  let limit = Math.max(0, Math.min(100, Math.trunc(opts?.limit ?? 20)))
  if (!limit) return []
  return say(words, await find(words, Math.max(20, limit * 2)), limit)
}
