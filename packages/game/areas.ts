// A ground area belongs to its caster's fight, not the first foes hit. Its
// next pulse tests current positions, so entering and leaving matter.
import type { Effect } from './status.ts'

export type AreaEffect<E extends Effect = Effect> = {
  kind: string
  ms: number
  radius: number
  effects: E[]
}
export type Area<E extends Effect = Effect, C extends object = object> = {
  id: string
  source: string
  level: string
  name: string
  x: number
  y: number
  z: number
  radius: number
  start: number
  until: number
  next: number
  effects: E[]
} & C

export let areas = <E extends Effect = Effect, C extends object = object>(
  value: unknown,
): Area<E, C>[] =>
  Array.isArray(value)
    ? value.filter((a) =>
      typeof a?.id == 'string' &&
      typeof a?.source == 'string' && typeof a?.until == 'number' &&
      typeof a?.next == 'number' && typeof a?.radius == 'number' &&
      typeof a?.x == 'number' && typeof a?.z == 'number' &&
      Array.isArray(a?.effects)
    )
    : []

export let planted = <E extends Effect, C extends object>(
  e: AreaEffect<E>,
  source: string,
  level: string,
  name: string,
  at: { x: number; y: number; z: number },
  now: number,
  context: C,
): Area<E, C> => ({
  ...context,
  id: crypto.randomUUID(),
  source,
  level,
  name,
  ...at,
  radius: e.radius,
  start: now,
  until: now + e.ms,
  next: now + 1000,
  effects: e.effects,
})

export let within = (a: Area, at: { x: number; z: number }) =>
  Math.hypot(a.x - at.x, a.z - at.z) <= a.radius

/** A late frame pulses once on current occupants, not retroactively on
 * occupants whose old positions we do not know. No pulse after expiry. */
export let pulse = (a: Area, now: number) => now >= a.next && now <= a.until

export let following = (a: Area, now: number) =>
  a.next + (Math.floor((now - a.next) / 1000) + 1) * 1000

/** Friendly effects use the shared clock, independent of when the caster
 * publishes its advanced cursor. Only the receiving hero changes health. */
export let received = (a: Area, now: number) =>
  now > a.until ? 0 : a.start + Math.floor((now - a.start) / 1000) * 1000
