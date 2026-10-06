// Lossless, guarded plans for moving persisted fight.dealt JSON text to the
// declared array. This module never writes a store; keep the original export
// until the operator verifies every restored value.
import { type Bundle, type Comp, token } from '@yaks/graph'

let fight = (row: Bundle) => row.fight as Comp | undefined
let guarded = (value: Comp) =>
  Object.fromEntries(
    Object.entries(value).map(([prop, v]) => [prop, token(v)]),
  )

/** Parse without normalizing: extra fields, ordering and numeric values survive. */
export let dealings = (text: string, eid: string): unknown[] => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${eid}: fight.dealt is not JSON; nothing may be cleared`)
  }
  if (
    !Array.isArray(value) ||
    value.some((v) =>
      !v || typeof v != 'object' || Array.isArray(v) ||
      typeof v.foe != 'string' ||
      ['life', 'dmg', 'held'].some((p) =>
        typeof v[p] != 'number' || !Number.isFinite(v[p])
      )
    )
  ) {
    throw new Error(
      `${eid}: fight.dealt is not a dealings array; nothing may be cleared`,
    )
  }
  return value
}

/** Validate the WHOLE export before returning any clears. No row or component
 * is removed; only the source property becomes absent for the declaration cutover. */
export let cleared = (rows: Bundle[]): Bundle[] => {
  let seen = new Set<string>()
  return rows.flatMap((row) => {
    if (seen.has(row.entity.eid)) {
      throw new Error(`duplicate ${row.entity.eid}`)
    }
    seen.add(row.entity.eid)
    let value = fight(row)
    if (value?.dealt == null) return []
    if (typeof value.dealt != 'string') {
      throw new Error(`${row.entity.eid}: expected legacy text`)
    }
    dealings(value.dealt, row.entity.eid)
    return [{
      entity: { eid: row.entity.eid },
      fight: { dealt: null },
      $was: { fight: guarded(value) },
    }]
  })
}

/** Restore from the retained export only if the source is still absent and the
 * rest of this fight is unchanged. A concurrent new value is never overwritten.
 * Repeating a completed restore produces no patches. */
export let restored = (
  before: Bundle[],
  current: Bundle[],
  text = false,
): Bundle[] => {
  cleared(before)
  let now = new Map(current.map((r) => [r.entity.eid, r]))
  return before.flatMap((row) => {
    let old = fight(row)
    if (typeof old?.dealt != 'string') return []
    let value = text ? old.dealt : dealings(old.dealt, row.entity.eid)
    let live = fight(now.get(row.entity.eid) ?? { entity: row.entity })
    if (!live) {
      throw new Error(
        `${row.entity.eid}: fight disappeared; do not resurrect it`,
      )
    }
    if (token(live.dealt) == token(value)) return []
    if (live.dealt != null) {
      throw new Error(
        `${row.entity.eid}: fight.dealt changed; do not overwrite it`,
      )
    }
    let other = { ...old }
    delete other.dealt
    if (
      Object.keys(live).some((p) => p != 'dealt' && !(p in other)) ||
      Object.entries(other).some(([p, v]) => token(live[p]) != token(v))
    ) {
      throw new Error(`${row.entity.eid}: fight changed; do not overwrite it`)
    }
    return [{
      entity: { eid: row.entity.eid },
      fight: { dealt: value },
      $was: { fight: { ...guarded(other), dealt: null } },
    }]
  })
}
