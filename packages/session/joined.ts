// Which entries make the lines of a conversation: one pure function every
// drawing of a transcript shares, whatever draws its lines (./conversation.ts,
// browse's session page). It reads nothing but the entries.

import type { Bundle } from '@yaks/render'
import { CALL } from './native.ts'

let comp = (b: Bundle, name: string) =>
  b[name] as Record<string, unknown> | undefined

/** A line of a conversation: the entry it is drawn at, the result that
 * answered it when that entry is a call, and how many entries in a row it
 * stands for (`n`), where it stands for more than its own. */
export type Joined = { entry: Bundle; result?: Bundle; n?: number }

/**
 * Which entries make the lines of a conversation, in its order: each entry is
 * a line, except a result whose call is among them, which joins that call's
 * line, so an answer settles in its call's place however many calls ran
 * beside it. A result whose call is not among them is a line of its own.
 * Where `same` says an entry repeats the one before it (a stream telling one
 * fact frame by frame), the run is one line: its last entry, counting the
 * run.
 *
 * ```ts
 * import { joined } from './joined.ts'
 * import { equal } from '@yaks/testing'
 * let e = (eid: string, comps = {}) => ({ entity: { eid }, entry: {}, ...comps })
 * let lines = joined([
 *   e('c', { call: { to: 't' } }),
 *   e('w', { content: { body: 'Hi' } }),
 *   e('r', { result: { call: 'c' } }),
 *   e('lone', { result: { call: 'gone' } }),
 * ])
 * equal(lines.map((l) => [l.entry.entity.eid, l.result?.entity.eid]), [
 *   ['c', 'r'],
 *   ['w', undefined],
 *   ['lone', undefined],
 * ])
 * ```
 */
export let joined = (
  entries: Bundle[],
  same?: (a: Bundle, b: Bundle) => boolean,
): Joined[] => {
  let calls = new Set(entries.filter((b) => b[CALL]).map((b) => b.entity.eid))
  let answer = (b: Bundle) => {
    let call = comp(b, 'result')?.call
    return call != null && calls.has(String(call)) ? String(call) : undefined
  }
  let results = new Map(
    entries.flatMap((b) => {
      let call = answer(b)
      return call ? [[call, b] as const] : []
    }),
  )
  let out: Joined[] = []
  for (let b of entries) {
    if (answer(b)) continue
    let last = out.at(-1)
    if (last && same?.(last.entry, b)) {
      out[out.length - 1] = { entry: b, n: (last.n ?? 1) + 1 }
      continue
    }
    let result = results.get(b.entity.eid)
    out.push(result ? { entry: b, result } : { entry: b })
  }
  return out
}
