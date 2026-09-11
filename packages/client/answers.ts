// Only keys, ordered ids and coverage. Payloads remain exclusively in RAM.
import type { Eid } from '@yaks/graph'
import type { Coverage } from '@yaks/sync'

/** An unready, epoch-scoped server answer floor. Never locally re-evaluated. */
export type SavedAnswer = {
  key: string
  members: [Eid, Coverage][]
  peers: [Eid, Coverage][]
}

/** Byte budget includes query text, every id and all coverage metadata. */
export const ANSWER_BYTES = 1_000_000

/** Bounded LRU of semantic answers, not a payload cache. Oversized answers are
 * omitted whole rather than misrepresenting a truncated ranking as complete. */
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
