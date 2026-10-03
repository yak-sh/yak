// A world position, whether relayed by a connected page or saved in the store.
import { levelOf } from './levels.ts'
import { regionOf } from './regions.ts'

export type Place = {
  level: string
  x: number
  y?: number
  z: number
  at?: number
}

export let placeOf = (
  row: Record<string, unknown> | undefined,
  source: 'position' | 'companion',
): Place | null => {
  let value = row?.[source]
  if (!value || typeof value != 'object') return null
  let { level, x, y, z, at } = value as Record<string, unknown>
  if (
    source == 'companion' && typeof x == 'number' &&
    typeof z == 'number' && Number.isFinite(x) && Number.isFinite(z)
  ) {
    level = regionOf(x, z)
  }
  if (
    typeof level != 'string' || !levelOf(level) ||
    typeof x != 'number' || !Number.isFinite(x) ||
    typeof z != 'number' || !Number.isFinite(z) ||
    regionOf(x, z) != level
  ) return null
  let time = typeof at == 'number' ? at : Date.parse(String(at))
  return {
    level,
    x,
    z,
    ...(typeof y == 'number' && Number.isFinite(y) ? { y } : {}),
    ...(Number.isFinite(time) ? { at: time } : {}),
  }
}

export let placeText = (place: Place, source: 'live' | 'saved'): string =>
  `${source == 'live' ? 'Live position' : 'Last saved position'}: **${
    levelOf(place.level)?.name ?? place.level
  }** (${place.level}), x ${place.x}, z ${place.z}` +
  (place.at ? `, ${new Date(place.at).toISOString()}` : '')
