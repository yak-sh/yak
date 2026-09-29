// A position answered by the game's live relay or by its saved `seen` row.
// The two sources have the same coordinates, but only `seen` survives a
// disconnected page.
import { LEVELS } from './levels.ts'
import { regionOf } from './regions.ts'

export type Place = {
  level: string
  x: number
  z: number
  at?: number
}

export let placeOf = (
  row: Record<string, unknown> | undefined,
  source: 'position' | 'seen',
): Place | null => {
  let value = row?.[source]
  if (!value || typeof value != 'object') return null
  let { level, x, z, at } = value as Record<string, unknown>
  if (
    typeof level != 'string' || !Object.hasOwn(LEVELS, level) ||
    typeof x != 'number' || !Number.isFinite(x) ||
    typeof z != 'number' || !Number.isFinite(z) ||
    regionOf(x, z) != level
  ) return null
  let time = typeof at == 'number' ? at : Date.parse(String(at))
  return { level, x, z, ...(Number.isFinite(time) ? { at: time } : {}) }
}

export let placeText = (place: Place, source: 'live' | 'saved'): string =>
  `${source == 'live' ? 'Live position' : 'Last saved position'}: **${
    LEVELS[place.level].name
  }** (${place.level}), x ${place.x}, z ${place.z}` +
  (place.at ? `, ${new Date(place.at).toISOString()}` : '')
