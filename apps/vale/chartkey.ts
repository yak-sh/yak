// Only design components affect chart images; graph identities and row order
// do not. The deployment and page use the same content address.
import type { Bundle } from './net.ts'
import { comp } from './bundle.ts'

let ordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value == 'object') {
    // The store materializes absent optional fields as null; terrain treats
    // both forms alike, so seeded and stored designs share an address.
    return Object.fromEntries(
      Object.entries(value).filter(([, value]) => value != null).sort((
        [a],
        [b],
      ) => a.localeCompare(b)).map((
        [key, value],
      ) => [key, ordered(value)]),
    )
  }
  return value
}

/** Content address for the two sets of designs used to paint ground. */
export let chartKey = async (themes: Bundle[], buildings: Bundle[]) => {
  let rows = (rows: Bundle[], name: string) =>
    rows.map((row) => JSON.stringify(ordered(comp(row, name)))).sort()
  let bytes = new TextEncoder().encode(JSON.stringify([
    rows(themes, 'theme_design'),
    rows(buildings, 'building_design'),
  ]))
  let digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}
