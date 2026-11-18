import type { Saved } from './vault.ts'

/** A removed browser-owned snapshot. It stays private to its vault. */
export type Trashed = { id: string; at: number; row: Saved }

let object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value == 'object' && !Array.isArray(value)

/** Whether a replacement removes a component or a property. Ordinary text
 * edits replace their value without creating an unbounded history. */
export let removed = (before: unknown, now: unknown): boolean =>
  object(before) &&
  Object.entries(before).some(([key, value]) =>
    !object(now) || !(key in now) || removed(value, now[key])
  )

let fill = (before: unknown, now: unknown): unknown => {
  if (!object(before) || !object(now)) return now ?? before
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(now)])].map((
      key,
    ) => [key, key in now ? fill(before[key], now[key]) : before[key]]),
  )
}

/** Recover missing values while retaining edits made after removal. */
export let recover = (before: Saved, now?: Saved): Saved =>
  structuredClone(
    now
      ? {
        ...before,
        ...now,
        comps: fill(before.comps, now.comps) as Saved['comps'],
      }
      : before,
  )
