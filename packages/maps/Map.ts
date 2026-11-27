/**
 * A map a person moves: `<Map center={[32.58, 0.43]} zoom={12} pins={…} />`,
 * one pin for each place given, such as an app's rows made into
 * `{at, label}`. `onMap` is handed the MapLibre map once it is drawn, for
 * layers, popups and events of the app's own. On a page it moves with two
 * fingers or a modifier key, so scrolling past it scrolls the page.
 *
 * @module
 */
import { createElement as h, type ReactElement } from 'react'
import type { Map as MapLibre } from 'maplibre-gl'
import type { LngLat, Pin } from './draw.ts'
import { Frame } from './frame.ts'
import type { Tiles } from './providers.ts'

export type MapProps = {
  /** where it opens: longitude east, then latitude north */
  center: LngLat
  /** how close it opens: 3 shows a country, 14 a neighbourhood */
  zoom?: number
  /** the places it pins */
  pins?: Pin[]
  /** what the map shows, said to a screen reader */
  title?: string
  lang?: string
  base?: string
  provider?: Tiles
  onMap?: (map: MapLibre) => void
}

/** A map a person moves, with a pin for each place. */
export let Map = (p: MapProps): ReactElement =>
  h(Frame, {
    center: p.center,
    zoom: p.zoom ?? 12,
    pins: p.pins,
    interactive: true,
    lang: p.lang,
    base: p.base,
    provider: p.provider,
    onMap: p.onMap,
    title: p.title ?? 'Map',
  }) as ReactElement
