// Verbatim evidence selection enforces the historical cutoff.
import type { Bundle } from '@yaks/graph'

export function ownerWords(rows: Bundle[], cutoff: string) {
  return rows.map((row) => {
    let at = (row.created as { at?: string } | undefined)?.at
    let body = (row.content as { body?: string } | undefined)?.body ??
      (row.doc as { body?: string } | undefined)?.body
    if (
      !at || !cutoff || !Number.isFinite(Date.parse(at)) ||
      !Number.isFinite(Date.parse(cutoff)) ||
      Date.parse(at) >= Date.parse(cutoff)
    ) {
      throw new Error('Owner evidence must strictly precede the case')
    }
    if (typeof body != 'string') {
      throw new Error('Owner evidence needs verbatim text')
    }
    // Never spread a corpus object, rubric, mutable task or transcript state.
    return { id: row.entity.eid, at, words: body }
  })
}
