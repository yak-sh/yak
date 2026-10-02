// A targeted design update preserves every property a person changed. The
// baseline is the previous shipped seed, not the row's age or authorship.
import { token } from '@yaks/graph'
import type { Bundle } from './net.ts'
import { comp } from './bundle.ts'

let equal = (a: unknown, b: unknown): boolean => {
  if (a == null || b == null) return a == b
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length == b.length &&
      a.every((v, i) => equal(v, b[i]))
  }
  if (typeof a != 'object' || typeof b != 'object') return a === b
  let x = Object.fromEntries(Object.entries(a)),
    y = Object.fromEntries(Object.entries(b))
  return Object.keys(x).length == Object.keys(y).length &&
    Object.keys(x).every((k) => equal(x[k], y[k]))
}

export let updated = (
  live: Bundle[],
  before: Bundle[],
  after: Bundle[],
): Bundle[] => {
  let old = new Map(
    before.map((r) => [r.entity.eid, comp(r, 'ability_design')]),
  )
  let next = new Map(
    after.map((r) => [r.entity.eid, comp(r, 'ability_design')]),
  )
  return live.flatMap((r) => {
    let was = old.get(r.entity.eid),
      now = next.get(r.entity.eid),
      held = comp(r, 'ability_design')
    if (!was || !now || !held) return []
    let patch = Object.fromEntries(
      Object.entries(now).filter(([key, value]) =>
        !equal(value, was[key]) && equal(held[key], was[key])
      ),
    )
    return Object.keys(patch).length
      ? [{
        entity: { eid: r.entity.eid },
        ability_design: patch,
        $was: {
          ability_design: Object.fromEntries(
            Object.keys(patch).map((k) => [k, token(held[k])]),
          ),
        },
      }]
      : []
  })
}

// Old scalar fields are removed only when an effects list already holds the
// canonical authored data. This leaves an unconverted row untouched.
export let cleaned = (live: Bundle[]): Bundle[] =>
  live.flatMap((r) => {
    let a = comp(r, 'ability_design')
    if (!Array.isArray(a?.effects) || !a.effects.length) return []
    let keys = [
      'dmg',
      'hits',
      'sure',
      'held',
      'bleed',
      'dash',
      'behind',
      'guard',
      'ward',
      'heal',
      'refund',
    ]
      .filter((k) => a[k] != null)
    return keys.length
      ? [{
        entity: { eid: r.entity.eid },
        ability_design: Object.fromEntries(keys.map((k) => [k, null])),
        $was: {
          ability_design: {
            effects: token(a.effects),
            ...Object.fromEntries(keys.map((k) => [k, token(a[k])])),
          },
        },
      }]
      : []
  })

/** Reads an admin query response (whose content contains rows), or plain rows. */
export let unpacked = (value: unknown): Bundle[] => {
  if (Array.isArray(value)) return value
  if (
    value && typeof value == 'object' && 'result' in value &&
    Array.isArray(value.result)
  ) {
    let said = value.result.find((r) => r?.content?.body)
    if (said) return JSON.parse(said.content.body)
  }
  throw new Error('Expected graph query rows or an admin query response')
}
