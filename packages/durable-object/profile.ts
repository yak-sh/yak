// A bounded, in-memory summary of the rows a Durable Object's SQL statements
// cost. The adapter observes cursor counters; the host names an invocation and
// decides when to flush. No statement values or rows leave this module.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Observe, Sample } from './sql.ts'

export type Cost = {
  calls: number
  rowsRead: number
  rowsWritten: number
}

export type Entry = Cost & { id: string; shape: string }

export type Operation = {
  kind: string
  total: Cost
  statements: Entry[]
  other: Cost
}

export type Summary = {
  ms: number
  total: Cost
  statements: Entry[]
  other: Cost
  operations: Operation[]
}

type Group = {
  total: Cost
  other: Cost
  shapes: Map<string, Entry>
}

let empty = (): Cost => ({ calls: 0, rowsRead: 0, rowsWritten: 0 })
let group = (): Group => ({ total: empty(), other: empty(), shapes: new Map() })
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

let tally = (into: Group, sample: Sample, limit: number) => {
  let cost = {
    calls: 1,
    rowsRead: sample.rowsRead,
    rowsWritten: sample.rowsWritten,
  }
  add(into.total, cost)
  let key = id(sample.shape)
  let entry = into.shapes.get(key)
  if (!entry) {
    if (into.shapes.size == limit) {
      let rare = [...into.shapes.values()].reduce((a, b) =>
        weight(a) <= weight(b) ? a : b
      )
      if (weight(cost) > weight(rare)) {
        into.shapes.delete(rare.id)
        add(into.other, rare)
      }
    }
    if (into.shapes.size < limit) {
      entry = { ...empty(), id: key, shape: sample.shape.slice(0, 240) }
      into.shapes.set(key, entry)
    }
  }
  add(entry ?? into.other, cost)
}

let finish = (g: Group, reads: number, writes: number) => {
  let ranked = [...g.shapes.values()].sort((a, b) => b.rowsRead - a.rowsRead)
  let top = ranked.slice(0, reads)
  let written = [...ranked].sort((a, b) => b.rowsWritten - a.rowsWritten)
  for (let entry of written) {
    if (top.length == reads + writes) break
    if (!top.includes(entry)) top.push(entry)
  }
  for (let entry of ranked) if (!top.includes(entry)) add(g.other, entry)
  return { total: g.total, statements: top, other: g.other }
}

/** Report the first nonempty window at once, then at most once per minute
 * while this object stays awake. Shape and invocation buckets have fixed caps;
 * `other` sums anything beyond them. `run` keeps a label across awaits, even
 * when another request runs on the same object before the first resumes. */
export let profile = (
  emit: (summary: Summary) => void,
  now = Date.now,
): {
  observe: Observe
  run: <T>(kind: string, work: () => T) => T
  flush: (now?: number) => void
} => {
  let here = new AsyncLocalStorage<string>()
  let since: number | null = null
  let total = group()
  let operations = new Map<string, Group>()
  let reported = false
  let first = true
  let observe = (sample: Sample) => {
    since ??= now()
    tally(total, sample, 64)
    let kind = here.getStore() ?? 'unattributed'
    if (!operations.has(kind) && operations.size >= 15) kind = 'other'
    let one = operations.get(kind)
    if (!one) operations.set(kind, one = group())
    tally(one, sample, 24)
  }
  let flush = (at = now()) => {
    if (since == null || (!first && at - since < 60_000)) return
    let all = finish(total, 10, 2)
    let byKind = [...operations].map(([kind, g]) => ({
      kind,
      ...finish(g, 5, 2),
    }))
    try {
      emit({ ms: at - since, ...all, operations: byKind })
    } catch (e) {
      if (!reported) console.error('row profile report failed', e)
      reported = true
    }
    since = null
    first = false
    total = group()
    operations = new Map()
  }
  return { observe, run: (kind, work) => here.run(kind, work), flush }
}
