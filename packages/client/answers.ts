// The saved results of server subscriptions: a query key, its members in
// order, and which properties the server covered for each. Only ids and that
// coverage are saved here — the entities themselves stay in memory only.
import type { Eid } from '@yaks/graph'
import type { Coverage } from '@yaks/sync'

/** One server subscription's result as it was last delivered, scoped to a
 * server epoch. It is what a reopened watch can show before the server
 * answers again, and it is never re-evaluated against local data. */
export type SavedAnswer = {
  key: string
  members: [Eid, Coverage][]
  peers: [Eid, Coverage][]
}

/** The default byte budget, counting the query text, every id and all the
 * coverage metadata. */
export const ANSWER_BYTES = 1_000_000

/** A least-recently-used cache of those results, bounded in bytes. It holds
 * no entity data. A result too large for the whole budget is dropped rather
 * than truncated, because a truncated ranking would be indistinguishable from
 * a complete one. */
export let answerCache = (limit: number = ANSWER_BYTES): {
  get: (key: string) => SavedAnswer | undefined
  put: (answer: SavedAnswer) => void
  clear: () => void
  values: () => SavedAnswer[]
  bytes: () => number
} => {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('invalid answer byte limit')
  }
  let entries = new Map<string, { answer: SavedAnswer; bytes: number }>()
  let size = 0
  return {
    get: (key) => {
      let entry = entries.get(key)
      if (entry) {
        entries.delete(key)
        entries.set(key, entry)
      }
      return entry?.answer
    },
    put: (answer) => {
      let bytes = new TextEncoder().encode(JSON.stringify(answer)).length
      size -= entries.get(answer.key)?.bytes ?? 0
      entries.delete(answer.key)
      if (bytes <= limit) {
        entries.set(answer.key, { answer: structuredClone(answer), bytes })
        size += bytes
      }
      while (size > limit) {
        let key = entries.keys().next().value!
        size -= entries.get(key)!.bytes
        entries.delete(key)
      }
    },
    clear: () => {
      entries.clear()
      size = 0
    },
    values: () => [...entries.values()].map((e) => e.answer),
    bytes: () => size,
  }
}
