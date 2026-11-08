// A stamp as a person reads it: when, and who (T-151161). Every page of
// yaks.app and /admin that shows one says it through `said`, with the names
// `writers` gives the rows its writers are, so each says the same of it: a
// person by the name they go by, an agent as itself for the person it writes
// for (M-31958), and only the day where who wrote it is not known.
import { day } from './html.ts'

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

/** What each writer row is called: an agent as its name for its person, any
 * other row (a person) as a person. */
export let writers = (rows: Row[]): Map<string, string> => {
  let people = new Map(
    rows.filter((r) => !r.acts_for).map((r) => [r.entity.eid, personName(r)]),
  )
  return new Map([
    ...people,
    ...rows.filter((r) => r.acts_for).map((r) => {
      let of = people.get(idOf((r.acts_for as Comp)?.person) ?? '')
      let name = str((r.doc as Comp)?.title) || 'an agent'
      return [r.entity.eid, of ? `${name} for ${of}` : name] as const
    }),
  ])
}

/// said({ at: '2026-11-05T06:09:38Z', by: 'a' }, new Map([['a', 'yak for Jeffrey']])) -> '5 November 2026 by yak for Jeffrey'
/// said({ at: '2026-11-05T06:09:38Z', by: 'a' }, new Map(), 'short') -> '5 Nov 2026'
/// said(null, new Map()) -> ''
export let said = (
  s: Stamp | null | undefined,
  names: Writers,
  month: 'long' | 'short' = 'long',
) => {
  if (!s) return ''
  let who = s.by ? names.get(s.by) : undefined
  return who ? `${day(s.at, month)} by ${who}` : day(s.at, month)
}
