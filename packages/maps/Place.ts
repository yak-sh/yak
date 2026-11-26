/**
 * One place on a still map: `<Place at={[32.5825, 0.4300]} label="Office"
 * zoom={14} />`. The map wears the page's theme, pins the place in its
 * accent with its label, credits OpenStreetMap, and links to directions.
 * `at` is longitude east, then latitude north, as MapLibre takes it.
 *
 * @module
 */
import { h, type VNode } from 'preact'
import type { Map as MapLibre } from 'maplibre-gl'
import { directions, type LngLat } from './draw.ts'
import { Frame } from './frame.ts'
import type { Tiles } from './providers.ts'

export type PlaceProps = {
  /** where it is: longitude east, then latitude north */
  at: LngLat
  /** what its pin says, and what the map is called to a screen reader */
  label?: string
  /** how close: 3 shows a country, 14 a neighbourhood, 17 a street */
  zoom?: number
  /** the language the map's own labels are written in, `en` unless given */
  lang?: string
  /** the words of the directions link, or false for none */
  directions?: string | false
  base?: string
  provider?: Tiles
  onMap?: (map: MapLibre) => void
}

/** One place on a still map. */
export let Place = (p: PlaceProps): VNode =>
  h(Frame, {
    center: p.at,
    zoom: p.zoom ?? 14,
    pins: [{ at: p.at, label: p.label }],
    interactive: false,
    lang: p.lang,
    base: p.base,
    provider: p.provider,
    onMap: p.onMap,
    title: p.label ? `Map of ${p.label}` : 'Map',
    links: p.directions === false ? null : h('a', {
      href: directions(p.at),
      target: '_blank',
      rel: 'noopener',
    }, p.directions ?? 'Directions'),
  }) as VNode
