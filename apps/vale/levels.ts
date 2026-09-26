// The levels: each a place of its own, grown from its seed and its places by
// terrain.ts, so every page grows the same one and none of it is stored. A
// place is a kind of ground (terrain.ts `FEATURES`: a village, woods, crags,
// a ridge, a lake, fields) at a point; the creatures that live around each
// kind come from beasts.ts, the people who stand at them from quests.ts.
// Portals join levels: walking through one arrives at the portal on the far
// side that leads back. A new level is a row here.

/** A point on a level's ground, in metres `[east, south]` from its corner; a
 * level is 128 m on a side (terrain.ts `SIZE`). */
export type Spot = [number, number]

export type Place = { kind: string; at: Spot }

export type Portal = { at: Spot; to: string }

export type Level = {
  id: string
  name: string
  /** what the noise is salted with; 0 grows Mossvale as it always was */
  seed: number
  /** where a new hero first stands: one of the places */
  arrive: string
  places: Record<string, Place>
  portals: Portal[]
}

export let LEVELS: Record<string, Level> = {
  mossvale: {
    id: 'mossvale',
    name: 'Mossvale',
    seed: 0,
    arrive: 'plaza',
    places: {
      crags: { kind: 'crags', at: [30, 98] },
      ridge: { kind: 'ridge', at: [102, 100] },
      woods: { kind: 'woods', at: [66, 25] },
      lake: { kind: 'lake', at: [26, 49] },
      fields: { kind: 'fields', at: [99, 52] },
      plaza: { kind: 'village', at: [64, 64] },
    },
    portals: [{ at: [84, 71], to: 'birchmere' }],
  },
  birchmere: {
    id: 'birchmere',
    name: 'Birchmere',
    seed: 7,
    arrive: 'green',
    places: {
      mere: { kind: 'lake', at: [48, 75] },
      woods: { kind: 'woods', at: [85, 35] },
      east: { kind: 'woods', at: [98, 85] },
      fields: { kind: 'fields', at: [40, 35] },
      green: { kind: 'village', at: [69, 62] },
    },
    portals: [{ at: [75, 75], to: 'mossvale' }],
  },
}
