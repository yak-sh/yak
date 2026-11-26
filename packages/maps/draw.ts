// Drawing a map into an element: MapLibre, loaded only when a page draws its
// first map, given the style the page's own theme makes (style.ts,
// theme.ts), with a pin for each place in the theme's accent. <Place> and
// <Map> are this, in Preact.
import type { Map as MapLibre, MapOptions } from 'maplibre-gl'
import { type Tiles, TILES_DEFAULT } from './providers.ts'
import { style } from './style.ts'
import { themeOf } from './theme.ts'
import { LOOK } from './look.ts'

/** A point as MapLibre takes it: longitude east, then latitude north. */
export type LngLat = [number, number]

/** A place a map pins: where it is, and what its pin says. */
export type Pin = { at: LngLat; label?: string }

/** Where yaks.app serves map tiles and fonts (@yaks/maps/tiles). */
export let MAPS = 'https://yaks.app/maps'

/** What a map is drawn with. `base` is where its tiles are served and
 * `provider` the row they come from; both are yaks.app's by default. */
export type Drawing = {
  center: LngLat
  zoom: number
  pins?: Pin[]
  interactive?: boolean
  lang?: string
  base?: string
  provider?: Tiles
}

let looked = false
// The map's own few rules, once a page (MapLibre's canvas and pins, and the
// credit line): inline, since a stylesheet beside a compiled module has no
// address a page can be sure of.
let look = () => {
  if (looked) return
  looked = true
  let sheet = document.createElement('style')
  sheet.dataset.yaksMaps = ''
  sheet.textContent = LOOK
  document.head.append(sheet)
}

/** A pin's element: a drop in the accent colour, and its label above it.
 * It is a picture named by its label: MapLibre names a marker without a
 * role a "Map marker" button, which a pin nobody presses is not. */
export let pinOf = (pin: Pin): HTMLElement => {
  let el = document.createElement('div')
  el.className = 'MapPin'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', pin.label || 'Pin')
  el.innerHTML = '<svg viewBox="0 0 24 32" aria-hidden="true">' +
    '<path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24' +
    ' 5.3 18.6 0 12 0z"/><circle cx="12" cy="12" r="4.5"/></svg>'
  if (pin.label) {
    let label = document.createElement('span')
    label.className = 'MapPin_Label'
    label.textContent = pin.label
    el.append(label)
  }
  return el
}

/** Draw a map into `el`, sized as `el` is, and answer it once drawn. Remove
 * it with `map.remove()` when `el` leaves the page. */
export let draw = async (
  el: HTMLElement,
  d: Drawing,
): Promise<MapLibre> => {
  look()
  let { default: maplibre } = await import('maplibre-gl')
  let base = d.base ?? MAPS, provider = d.provider ?? TILES_DEFAULT
  let options: MapOptions = {
    container: el,
    style: style(provider, themeOf(el), base, d.lang),
    center: d.center,
    zoom: d.zoom,
    maxZoom: 19,
    interactive: d.interactive ?? true,
    attributionControl: false,
    cooperativeGestures: d.interactive ?? true,
  }
  let map = new maplibre.Map(options)
  for (let pin of d.pins ?? []) {
    new maplibre.Marker({ element: pinOf(pin), anchor: 'bottom' })
      .setLngLat(pin.at).addTo(map)
  }
  return map
}

/** Where a person asks for directions to a point: OpenStreetMap's own
 * planner.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { directions } from '@yaks/maps/draw'
 * assertEquals(
 *   directions([32.582518, 0.430049]),
 *   'https://www.openstreetmap.org/directions?route=%3B0.430049%2C32.582518',
 * )
 * ```
 */
export let directions = ([lng, lat]: LngLat): string =>
  `https://www.openstreetmap.org/directions?route=%3B${lat}%2C${lng}`
