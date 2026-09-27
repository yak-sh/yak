// A checkpoint is the summary of a transcript prefix. The summary can be
// appended after newer entries: `through` names the last entry it replaces,
// so the next model sees the summary first and then everything after `through`.

import type { Bundle, Comp } from '@yaks/graph'
import { kindOf, seqOf } from './status.ts'

export let context = (entries: Bundle[]): Bundle[] => {
  let mark = entries.filter((b) => b.checkpoint).at(-1)
  if (!mark) return entries
  let through = (mark.checkpoint as Comp).through
  let boundary = through ? entries.find((b) => b.entity.eid == through) : mark
  let seq = boundary ? seqOf(boundary) : Number((mark.checkpoint as Comp).seq)
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error('Checkpoint has no boundary: ' + through)
  }
  return [
    mark,
    ...entries.filter((b) => b != mark && seqOf(b) > seq),
  ]
}

// Stop at an input boundary so the unsummarized suffix still has complete
// turns. A transcript with one oversized turn is summarized as a whole.
export let prefix = (entries: Bundle[], budget: number): Bundle[] => {
  let size = 0, end = 0, covered = 0
  for (let i = 0; i < entries.length; i++) {
    if (i && kindOf(entries[i]) == 'input' && size <= budget * 0.6) {
      end = i
      covered = size
    }
    size += JSON.stringify(entries[i]).length
  }
  return entries.slice(0, covered >= budget * 0.25 ? end : entries.length)
}
