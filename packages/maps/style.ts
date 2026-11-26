// A map in an app's own colours: a Protomaps flavor made from the theme's
// custom properties (yaks.app `kits`, Colours and type), and the MapLibre
// style drawn with it. Pure: the theme arrives as resolved colours
// (theme.ts reads them off a page), and nothing here touches a page.
//
// Land is the page (`--bg`). Water, parks and woods are tints of it toward
// blue and green, so they still read as water and parks in any palette.
// Roads are the theme's lines (`--border`), labels its text and muted text
// over a halo of the page, and the pin its `--accent`. Sprites are
// pre-coloured per flavor (docs.protomaps.com/basemaps/flavors), so the
// style draws no icons at all: points of interest are left out, and a
// shield, an arrow or a town's dot is drawn as its words alone.
import { type Flavor, layers, namedFlavor } from '@protomaps/basemaps'
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { lightness, mix } from './color.ts'
import type { Tiles } from './providers.ts'

/** An app's theme as a map reads it: each colour resolved to `#rrggbb` or
 * `rgb()`. `font` is the page's own typeface, which a map's HTML (a pin's
 * label) wears; the map's own labels are drawn from hosted glyphs. */
export type Theme = {
  bg: string
  surface: string
  border: string
  text: string
  muted: string
  accent: string
  font?: string
}

/** The theme a map wears where the page sets none: yaks.app's Gouache
 * colours. */
export let PLAIN: Theme = {
  bg: '#f6f1e7',
  surface: '#efe8da',
  border: '#cfc5b3',
  text: '#2b2620',
  muted: '#6f665a',
  accent: '#c2562f',
}

/** The fonts the hosted glyphs hold, as the flavor names them. */
export let FONTS = {
  regular: 'Noto Sans Regular',
  bold: 'Noto Sans Medium',
  italic: 'Noto Sans Italic',
}

let WATER = '#3d8fd1', GREEN = '#4f9a4a', SAND = '#d8b673'

/** The Protomaps flavor a theme makes: every colour the basemap draws, from
 * the theme's few.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { flavor, PLAIN } from '@yaks/maps/style'
 * let f = flavor(PLAIN)
 * assertEquals(f.earth, PLAIN.bg)
 * assertEquals(f.city_label, PLAIN.text)
 * assertEquals(f.pois, undefined)
 * ```
 */
export let flavor = (theme: Theme): Flavor => {
  let { bg, surface, border, text, muted } = theme
  let dark = lightness(bg) < 0.25
  let base = namedFlavor(dark ? 'dark' : 'light')
  let tint = (to: string, t: number) => mix(bg, to, t)
  let water = tint(WATER, dark ? 0.35 : 0.3)
  let park = tint(GREEN, 0.2), wood = tint(GREEN, 0.28)
  let ground = tint(text, 0.05), built = tint(text, 0.1)
  let minor = mix(bg, border, 0.55), road = border
  let major = mix(border, text, 0.15), highway = mix(border, text, 0.3)
  let casing = mix(bg, border, 0.3)
  let { pois: _, ...rest } = base
  return {
    ...rest,
    background: bg,
    earth: bg,
    water,
    park_a: park,
    park_b: park,
    wood_a: wood,
    wood_b: wood,
    scrub_a: tint(GREEN, 0.14),
    scrub_b: tint(GREEN, 0.14),
    glacier: mix(bg, '#ffffff', dark ? 0.1 : 0.5),
    sand: tint(SAND, 0.2),
    beach: tint(SAND, 0.25),
    hospital: ground,
    industrial: ground,
    school: ground,
    zoo: park,
    military: ground,
    aerodrome: ground,
    runway: built,
    pedestrian: surface,
    pier: surface,
    buildings: built,
    other: minor,
    minor_service: minor,
    minor_a: minor,
    minor_b: minor,
    link: road,
    major,
    highway,
    minor_service_casing: casing,
    minor_casing: casing,
    link_casing: casing,
    major_casing_early: casing,
    major_casing_late: casing,
    highway_casing_early: casing,
    highway_casing_late: casing,
    tunnel_other: minor,
    tunnel_minor: minor,
    tunnel_link: road,
    tunnel_major: major,
    tunnel_highway: highway,
    tunnel_other_casing: casing,
    tunnel_minor_casing: casing,
    tunnel_link_casing: casing,
    tunnel_major_casing: casing,
    tunnel_highway_casing: casing,
    bridges_other: minor,
    bridges_minor: minor,
    bridges_link: road,
    bridges_major: major,
    bridges_highway: highway,
    bridges_other_casing: casing,
    bridges_minor_casing: casing,
    bridges_link_casing: casing,
    bridges_major_casing: casing,
    bridges_highway_casing: casing,
    railway: mix(bg, text, 0.3),
    boundaries: muted,
    roads_label_minor: muted,
    roads_label_minor_halo: bg,
    roads_label_major: muted,
    roads_label_major_halo: bg,
    ocean_label: mix(water, text, 0.5),
    subplace_label: muted,
    subplace_label_halo: bg,
    city_label: text,
    city_label_halo: bg,
    state_label: muted,
    state_label_halo: bg,
    country_label: muted,
    address_label: muted,
    address_label_halo: bg,
    landcover: {
      barren: tint(SAND, 0.12),
      farmland: tint(GREEN, 0.08),
      forest: wood,
      glacier: mix(bg, '#ffffff', dark ? 0.1 : 0.5),
      grassland: park,
      scrub: tint(GREEN, 0.14),
      urban_area: ground,
    },
    ...FONTS,
  }
}

// A layer with its icon taken out: no sprite is served.
let iconless = (layer: LayerSpecification): LayerSpecification => {
  if (layer.type != 'symbol' || !layer.layout?.['icon-image']) return layer
  let { 'icon-image': _, ...layout } = layer.layout
  return { ...layer, layout }
}

/** The name the archive's source goes by in a style. */
export let SOURCE = 'protomaps'

/** The MapLibre style for a provider in a theme, its tiles and fonts read
 * from the door at `base` (`https://yaks.app/maps`): a style object for an
 * archive the host serves, or the address of one another site hosts, which
 * wears that site's look.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { PLAIN, style } from '@yaks/maps/style'
 * import { TILES } from '@yaks/maps'
 * let s = style(TILES.protomaps, PLAIN, 'https://yaks.app/maps')
 * if (typeof s == 'string') throw new Error('an archive makes a style')
 * assertEquals(s.glyphs, 'https://yaks.app/maps/fonts/{fontstack}/{range}.pbf')
 * assertEquals(JSON.stringify(s.layers).includes('icon-image'), false)
 * assertEquals(
 *   style(TILES.openfreemap, PLAIN, 'https://yaks.app/maps'),
 *   'https://tiles.openfreemap.org/styles/liberty',
 * )
 * ```
 */
export let style = (
  provider: Tiles,
  theme: Theme,
  base: string,
  lang = 'en',
): StyleSpecification | string => {
  if (!provider.archive) {
    if (!provider.style) {
      throw new Error(`maps: ${provider.name} has no archive and no style`)
    }
    return provider.style
  }
  return {
    version: 8,
    glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      [SOURCE]: {
        type: 'vector',
        url: `${base}/tiles.json`,
        attribution: provider.attribution,
      },
    },
    layers: layers(SOURCE, flavor(theme), { lang }).map(iconless),
  }
}
