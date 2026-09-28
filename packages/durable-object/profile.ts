// A bounded, in-memory summary of the rows a Durable Object's SQL statements
// cost. The adapter observes cursor counters; the host decides where a summary
// goes and when to call flush. No statement values or rows leave this module.

import type { Observe, Sample } from './sql.ts'

export type Cost = {
  calls: number
  rowsRead: number
  rowsWritten: number
}

export type Entry = Cost & { id: string; shape: string }

export type Summary = {
  ms: number
  total: Cost
  statements: Entry[]
  other: Cost
}

let empty = (): Cost => ({ calls: 0, rowsRead: 0, rowsWritten: 0 })
let add = (to: Cost, from: Cost) => {
  to.calls += from.calls
  to.rowsRead += from.rowsRead
  to.rowsWritten += from.rowsWritten
}
let weight = (c: Cost) => c.rowsRead + c.rowsWritten

// Two independent 32-bit streams keep the key small without retaining a long
// SQL shape in memory. The readable prefix is capped separately.
let id = (s: string): string => {
  let a = 2166136261
  let b = 2246822519
  for (let i = 0; i < s.length; i++) {
    let ch = s.charCodeAt(i)
    a = Math.imul(a ^ ch, 16777619)
    b = Math.imul(b ^ ch, 3266489917)
  }
  return `${s.length.toString(36)}-${(a >>> 0).toString(36)}-${
    (b >>> 0).toString(36)
  }`
}

/** Report the first nonempty window at once, then at most once per minute
 * while this object stays awake. Each report names the top ten by reads and
 * up to two more by writes; `other` sums the rest. */
export let profile = (
  emit: (summary: Summary) => void,
  now = Date.now,
): {
  observe: Observe
  flush: (now?: number) => void
} => {
  let since: number | null = null
  let total = empty()
  let other = empty()
  let shapes = new Map<string, Entry>()
  let reported = false
  let first = true
  let observe = (sample: Sample) => {
    since ??= now()
    let cost = {
      calls: 1,
      rowsRead: sample.rowsRead,
      rowsWritten: sample.rowsWritten,
    }
    add(total, cost)
    let key = id(sample.shape)
    let entry = shapes.get(key)
    if (!entry) {
      if (shapes.size == 64) {
        let rare = [...shapes.values()].reduce((a, b) =>
          weight(a) <= weight(b) ? a : b
        )
        if (weight(cost) > weight(rare)) {
          shapes.delete(rare.id)
          add(other, rare)
        }
      }
      if (shapes.size < 64) {
        entry = { ...empty(), id: key, shape: sample.shape.slice(0, 240) }
        shapes.set(key, entry)
      }
    }
    add(entry ?? other, cost)
  }
  let flush = (at = now()) => {
    if (since == null || (!first && at - since < 60_000)) return
    let ranked = [...shapes.values()].sort((a, b) => b.rowsRead - a.rowsRead)
    let top = ranked.slice(0, 10)
    let written = [...ranked].sort((a, b) => b.rowsWritten - a.rowsWritten)
    for (let entry of written) {
      if (top.length == 12) break
      if (!top.includes(entry)) top.push(entry)
    }
    for (let entry of ranked) if (!top.includes(entry)) add(other, entry)
    try {
      emit({ ms: at - since, total, statements: top, other })
    } catch (e) {
      if (!reported) console.error('row profile report failed', e)
      reported = true
    }
    since = null
    first = false
    total = empty()
    other = empty()
    shapes = new Map()
  }
  return { observe, flush }
}
