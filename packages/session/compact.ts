// A checkpoint is the summary of a transcript prefix. The summary can be
// appended after newer entries: `through` names the last entry it replaces,
// so the next model sees the summary first, then a protocol-complete suffix.

import type { Bundle, Comp } from '@yaks/graph'
import { kindOf, seqOf } from './status.ts'

let callOf = (b: Bundle): string | undefined => {
  let call = (b.result as Comp | undefined)?.call
  return call == null ? undefined : String(call)
}

// A result always travels with the call that gives it its provider id. An
// input may land while that call is running, so an input boundary alone does
// not keep the pair together.
let paired = (entries: Bundle[], end: number): number => {
  let calls = new Map(
    entries.flatMap((b, i) => b.call ? [[b.entity.eid, i] as const] : []),
  )
  while (true) {
    let split = entries.slice(end)
      .map(callOf)
      .flatMap((eid) => eid == null ? [] : [calls.get(eid)])
      .filter((i): i is number => i != null && i < end)
    let next = split.length ? Math.min(...split) : end
    if (next == end) return end
    end = next
  }
}

/** A suffix beginning no later than any call its results refer to. */
export let suffix = (entries: Bundle[], from: number): Bundle[] =>
  entries.slice(paired(entries, from))

export let context = (entries: Bundle[]): Bundle[] => {
  let mark = entries.filter((b) => b.checkpoint).at(-1)
  if (!mark) return entries
  let through = (mark.checkpoint as Comp).through
  let boundary = through ? entries.find((b) => b.entity.eid == through) : mark
  let seq = boundary ? seqOf(boundary) : Number((mark.checkpoint as Comp).seq)
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error('Checkpoint has no boundary: ' + through)
  }
  let rest = entries.filter((b) => b != mark)
  let from = rest.findIndex((b) => seqOf(b) > seq)
  return [mark, ...suffix(rest, from < 0 ? rest.length : from)]
}

// Prefer an input boundary, then retreat before any call answered on the
// other side. A transcript with one oversized turn is summarized as a whole.
export let prefix = (entries: Bundle[], budget: number): Bundle[] => {
  let size = 0, end = 0
  for (let i = 0; i < entries.length; i++) {
    if (i && kindOf(entries[i]) == 'input' && size <= budget * 0.6) {
      end = i
    }
    size += JSON.stringify(entries[i]).length
  }
  end = paired(entries, end)
  let prefix = entries.slice(0, end)
  let covered = prefix.reduce((n, b) => n + JSON.stringify(b).length, 0)
  return covered >= budget * 0.25 ? prefix : entries
}
