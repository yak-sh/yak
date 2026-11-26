/**
 * @yaks/maps: maps of OpenStreetMap data for any app, in the app's own
 * colours, from providers that are rows of data rather than code.
 *
 * - `TILES`, `GEOCODERS`: the providers, as data (providers.ts); `Tiles`
 *   and `Geocoder` their shapes, `map_tiles` and `geocoder` (vocab.json).
 * - `@yaks/maps/tiles`: the door that serves a PMTiles archive's tiles,
 *   TileJSON and label fonts from a bucket.
 * - `@yaks/maps/style`: `style(provider, theme, base)`, the MapLibre style a
 *   theme makes; `@yaks/maps/theme`: `themeOf(el)`, a page's theme.
 * - `@yaks/maps/Place`, `@yaks/maps/Map`: a still map of one place, and one
 *   a person moves, as Preact components.
 * - `@yaks/maps/lookup`: where a place is, asked of a geocoder once and kept.
 *
 * @module
 */
export {
  type Geocoder,
  GEOCODERS,
  TILES,
  type Tiles,
  TILES_DEFAULT,
} from './providers.ts'
export { draw, type Drawing, type LngLat, MAPS, type Pin } from './draw.ts'
export { Place, type PlaceProps } from './Place.ts'
export { Map, type MapProps } from './Map.ts'
