// A graft: another transcript's lines written as the beginning of a session,
// as a cutting from one tree grows on another. A fork continues a transcript
// within its store (`fork{from}`); a graft carries the lines themselves, so
// the session it starts holds them in a store that never had the original.
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { kindOf, ordered } from './state.ts'

// The lines a graft carries: what was said, asked and answered.
let CARRIED = new Set(['input', 'output', 'call', 'result', 'ask'])

// What a carried line keeps: the components that say what it is. What the
// provider kept about an ask, what it cost, the model chosen, the request it
// came in and its archive mark stay with the transcript they belong to.
let KEPT = [
  'content',
  'call',
  'result',
  'output',
  'ask',
  'channel',
  'system',
  'refusal',
  'exception',
]

// Lines the session wrote for itself rather than said: its prompts, a
// child's notice, the task it was given.
let OWN = ['prompt', 'notice', 'task_context']

/**
 * The rows that begin `session` with `lines`, another transcript's entries:
 * each line it carries (`CARRIED`) as a new entry of `session`, in transcript
 * order and appended after whatever the session holds, with the components
 * that say what it is (`KEPT`). A reference from one line to another names
 * the other's copy. Each copy's eid is derived from the session and the
 * original's, so giving the same lines again writes the same rows.
 *
 * ```ts
 * import { grafted } from './graft.ts'
 * import { assertEquals } from '@std/assert'
 * let at = (eid: string, seq: number, rest: object) => ({
 *   entity: { eid }, entry: { session: 'demo', seq }, ...rest,
 * })
 * let rows = grafted([
 *   at('said', 1, { content: { body: 'A guestbook' }, using: { model: 'm' } }),
 *   at('asked', 2, { ask: { to: 'm', through: 'said' }, anthropic: {} }),
 *   at('call', 3, { call: { name: 'app_deploy', source: 'asked' } }),
 *   at('done', 4, { result: { call: 'call', value: 1 } }),
 *   at('rule', 5, { prompt: { scope: 'local' }, content: { body: 'Be kind' } }),
 * ], 'mine')
 * assertEquals(rows.map((r) => Object.keys(r)), [
 *   ['entity', 'entry', 'content'],
 *   ['entity', 'entry', 'ask'],
 *   ['entity', 'entry', 'call'],
 *   ['entity', 'entry', 'result'],
 * ])
 * assertEquals((rows[3].result as { call: string }).call, rows[2].entity.eid)
 * assertEquals(rows[1].entry, { session: 'mine' })
 * ```
 */
export let grafted = (lines: Bundle[], session: Eid): Bundle[] => {
  let carried = ordered(lines).filter((b) =>
    CARRIED.has(kindOf(b) ?? '') && !OWN.some((c) => b[c])
  )
  let copy = new Map(
    carried.map((b) => [
      b.entity.eid,
      derivedEid(`graft|${session}|${b.entity.eid}`),
    ]),
  )
  let named = (v: unknown) => typeof v == 'string' ? copy.get(v) ?? v : v
  return carried.map((b) => {
    let from = (b.entry as Comp).from
    let row: Bundle = {
      entity: { eid: copy.get(b.entity.eid)! },
      entry: { session, ...from ? { from } : {} },
    }
    for (let name of KEPT) {
      let c = b[name] as Comp | undefined
      if (!c) continue
      row[name] = Object.fromEntries(
        Object.entries(c).map(([k, v]) => [k, named(v)]),
      )
    }
    return row
  })
}
