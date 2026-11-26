// The providers @yaks/maps ships as data: each JSON file beside this one is
// one row's component, `map_tiles` or `geocoder` (vocab.json). A host serves
// the tiles of the row it names; switching provider changes which row, and
// no app.
import protomaps from './protomaps.json' with { type: 'json' }
import openfreemap from './openfreemap.json' with { type: 'json' }
import nominatim from './nominatim.json' with { type: 'json' }

/** A tile provider: `map_tiles{name, title, archive, glyphs, style,
 * attribution, max_zoom, builds}`. One with `archive` is served from the
 * host's bucket; one with `style` is drawn from another site. */
export type Tiles = {
  name: string
  title: string
  archive?: string
  glyphs?: string
  style?: string
  attribution: string
  max_zoom?: number
  builds?: string
}

/** A lookup provider: `geocoder{name, title, search, interval,
 * attribution}`. */
export type Geocoder = {
  name: string
  title: string
  search: string
  interval: number
  attribution: string
}

/** The tile providers, by name. */
export let TILES: Record<string, Tiles> = { protomaps, openfreemap }

/** The tile provider yaks apps' maps are drawn from (D-482, T-3944). */
export let TILES_DEFAULT: Tiles = protomaps

/** The lookup providers, by name. */
export let GEOCODERS: Record<string, Geocoder> = { nominatim }
