import { time } from '@yaks/ui/parts'
import type { H } from '@yaks/render'
import { agentName } from '@yaks/platform/instrument'
// A stamp as a person reads it: when, and who (T-151161). Every page of
// yaks.app and /admin that shows one says it through `stamped`, with the names
// `writers` gives the rows its writers are, so each says the same of it: a
// person by the name they go by, an agent by the name the person's connections
// call it, "Claude" (@yaks/platform/agents `agentCalled`, M-31958), and only
// the day where who wrote it is not known.

/** When something was written, and the actor who wrote it, where known. */
export type Stamp = { at: string; by: string | null }

/** What each writer is called, by eid. */
export type Writers = ReadonlyMap<string, string>

type Comp = Record<string, unknown> | undefined
type Row = Record<string, unknown> & { entity: { eid: string; num?: number } }

let str = (v: unknown) => typeof v == 'string' ? v : ''
let idOf = (v: unknown) =>
  typeof v == 'string' ? v : str((v as Comp)?.eid) || null

/// stampOf({ at: '2026-11-05T06:09:38.401Z', by: { eid: 'p' } }) -> { at: '2026-11-05T06:09:38.401Z', by: 'p' }
/// stampOf({ by: 'p' }) -> null
export let stampOf = (c: unknown): Stamp | null =>
  str((c as Comp)?.at)
    ? { at: str((c as Comp)!.at), by: idOf((c as Comp)!.by) }
    : null

/** What to call a person, from their row. */
export let personName = (b: Record<string, unknown>) =>
  str((b.doc as Comp)?.title) ||
  str((b.email as Comp)?.address).split('@')[0] ||
  str((b.phone as Comp)?.number) ||
  `Person #${(b.entity as Comp)?.num ?? '?'}`

/** The persons the agents among `rows` write for, whose names theirs need. */
export let principals = (rows: Row[]) =>
  rows.flatMap((r) => idOf((r.acts_for as Comp)?.person) ?? [])

/**
 * What each writer row is called: an agent by its name, else "an agent",
 * and any other row (a person) as a person.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { agentRow, UNNAMED } from '@yaks/platform/instrument'
 * let jill = { entity: { eid: 'j' }, doc: { title: 'Jill' } }
 * let claude = agentRow('j', 'Claude'), unnamed = agentRow('j', UNNAMED)
 * assertEquals(
 *   [...writers([jill, claude, unnamed]).values()],
 *   ['Jill', 'Claude', 'an agent'],
 * )
 * ```
 */
export let writers = (rows: Row[]): Map<string, string> =>
  new Map(
    rows.map((r) => [
      r.entity.eid,
      r.acts_for ? agentName(r) ?? 'an agent' : personName(r),
    ]),
  )

/** A written moment and its writer, drawn through the kit's date face. */
export let stamped = <N>(
  h: H<N>,
  s: Stamp | null | undefined,
  names: Writers,
): N | null => {
  if (!s) return null
  let who = s.by ? names.get(s.by) : undefined
  return h('span', null, time(h, { at: s.at }), who ? ` by ${who}` : null)
}
