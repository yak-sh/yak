// The levels: each a place of its own, grown from its seed and its places by
// terrain.ts, so every page grows the same one and none of it is stored. A
// place is a kind of ground (terrain.ts `FEATURES`: a village, woods, crags,
// a ridge, a lake, fields) at a column; the creatures that live around each
// kind come from beasts.ts, the people who stand at them from quests.ts.
// Portals join levels: walking through one arrives at the portal on the far side
// that leads back. A new level is a row here.

/** A column of the 256 × 256 grid, `[east, south]`. */
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
      crags: { kind: 'crags', at: [60, 196] },
      ridge: { kind: 'ridge', at: [204, 200] },
      woods: { kind: 'woods', at: [132, 50] },
      lake: { kind: 'lake', at: [52, 98] },
      fields: { kind: 'fields', at: [198, 104] },
      plaza: { kind: 'village', at: [128, 128] },
    },
    portals: [{ at: [168, 142], to: 'birchmere' }],
  },
  birchmere: {
    id: 'birchmere',
    name: 'Birchmere',
    seed: 7,
    arrive: 'green',
    places: {
      mere: { kind: 'lake', at: [96, 150] },
      woods: { kind: 'woods', at: [170, 70] },
      east: { kind: 'woods', at: [196, 170] },
      fields: { kind: 'fields', at: [80, 70] },
      green: { kind: 'village', at: [138, 124] },
    },
    portals: [{ at: [150, 150], to: 'mossvale' }],
  },
}
