---
name: maps
description: "Maps (yaks.app). Drawing maps in an app with @yaks/maps, a platform dependency: <Place> for one place on a still map with a pin, its label and a directions link, and <Map> for a map a person moves, with a pin for each of an app's rows and the MapLibre map handed back for layers of its own. Both draw OpenStreetMap data served by yaks.app, in the app's own colours, with no key and no account. Finding a place's latitude and longitude once with place_find and writing it into the app, the credit OpenStreetMap asks for, sizing a map, and what maps cannot do yet."
---

# Maps

**@yaks/maps** draws maps of OpenStreetMap data in an app, in the app's own
colours. yaks.app serves the map tiles itself, so a map needs no key, no account
and no setup, and costs the space nothing. It is a platform dependency, named
`"platform"` in `package.json` like the kits (<https://yaks.app/docs/kits.md>):

- **`<Place>`** draws one place on a still map: a pin in the theme's accent, its
  label, the credit and a directions link. It is what a contact page or an
  event's page needs.
- **`<Map>`** draws a map a person moves, with a pin for each place it is given,
  such as an app's rows. It hands back the MapLibre map for layers, popups and
  events of the app's own.

What it costs: the page is a TypeScript module that `app_deploy` compiles
(<https://yaks.app/docs/code.md>), and the map library (MapLibre, about 280 KB
compressed) loads only on a page that draws a map.

Back to the map: <https://yaks.app/docs.md>.

## Finding where a place is

A map is drawn at a latitude and longitude. Find them once, while writing the
app, with the `place_find` tool: give it a name, an address, or a town and its
country.

```text
place_find { query: "Nakasongola, Uganda" }
→ Nakasongola, Central Region, Uganda
  lat 1.3089, lng 32.4637: <Place at={[32.4637, 1.3089]} />
```

Write the point into the app's code or its rows. A page never looks a place up
while someone visits: `place_find` keeps every answer, so asking again costs
nothing, and the geocoder behind it (OpenStreetMap's Nominatim) allows a single
request a second for all of yaks.app. A place a person has pinned in Google Maps
or sent as coordinates is written in as given.

`at`, `center` and a pin's `at` are **longitude first, then latitude**, as
MapLibre takes them: east is positive longitude and north is positive latitude.
Kampala is `[32.58, 0.35]`.

## The files

`package.json` names @yaks/maps and Preact:

```json
{
  "dependencies": {
    "@yaks/maps": "platform",
    "preact": "^10.29.1"
  }
}
```

`index.html` holds an element for the map and loads the module:

```html
<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Contact</title>
  <link rel="stylesheet" href="style.css">
  <main>
    <h1>Visit us</h1>
    <div id="map"></div>
  </main>
  <script type="module" src="main.ts"></script>
</html>
```

`main.ts` draws one place:

```ts ignore
import { createElement as h } from 'react'
import { render } from '@yaks/react/draw'
import { Place } from '@yaks/maps/Place'

render(
  h(Place, { at: [32.582518, 0.430049], label: 'Office', zoom: 15 }),
  document.getElementById('map')!,
)
```

`<Place>` takes:

| Prop         | What it is                                                    |
| ------------ | ------------------------------------------------------------- |
| `at`         | where the place is, `[longitude, latitude]`                   |
| `label`      | what its pin says; a screen reader hears "Map of" it          |
| `zoom`       | how close: 3 shows a country, 14 a neighbourhood, 17 a street |
| `directions` | the words of the directions link, or `false` for none         |
| `lang`       | the language the map's own labels are in, `en` unless given   |
| `onMap`      | handed the MapLibre map once it is drawn                      |

The directions link opens OpenStreetMap's route planner to the place.

## A map of an app's rows

`<Map>` takes `center`, `zoom` (12 unless given), `pins` (each `{ at, label }`),
`title` (what a screen reader hears), `lang` and `onMap`. Give it the app's rows
as pins, and draw it again when they change:

```ts ignore
import { createElement as h } from 'react'
import { render } from '@yaks/react/draw'
import { Map } from '@yaks/maps/Map'

let { subscribe } = await import(
  new URL('api/client.js', document.baseURI).href
)
let box = document.getElementById('map')!

subscribe(
  '.shop',
  (rows: { shop: { name: string; lat: number; lng: number } }[]) =>
    render(
      h(Map, {
        center: [32.58, 0.35],
        zoom: 12,
        title: 'Our shops',
        pins: rows.map((r) => ({
          at: [r.shop.lng, r.shop.lat],
          label: r.shop.name,
        })),
      }),
      box,
    ),
)
```

A person moves it with two fingers on a phone, or with Ctrl (⌘ on a Mac) and the
scroll wheel, so scrolling past the map scrolls the page.

`onMap` receives the MapLibre `Map`
(<https://maplibre.org/maplibre-gl-js/docs/>) once it is drawn: add a GeoJSON
layer of routes or areas, a popup, or a click handler there. The map is removed
when its element leaves the page.

## Colours, type and size

A map wears the theme's custom properties where it stands
(<https://yaks.app/docs/kits.md>, Colours and type): land is `--bg`, water and
parks are tints of it toward blue and green, roads are `--border`, place names
are `--text` and `--muted`, and the pin is `--accent`. A dark scheme written
with `light-dark()` draws a dark map. A pin's label is in `--font`; the map's
own place names are drawn in Noto Sans, a typeface yaks.app serves for maps. The
map shows no icons for shops or stations.

The map fills the width of its element at a 16:10 shape. Set `--map-ratio` on
the element (or any element around it) for another shape, such as
`--map-ratio: 1` for a square or `--map-ratio: 4/3`. Its corners and frame are
`--radius` and `--border`.

## The credit

OpenStreetMap's licence asks every map to credit it. `<Place>` and `<Map>` put
"Protomaps © OpenStreetMap", linked, behind a small ⓘ in the map's corner, which
opens on tap; keep it there.

## Not yet

- **Search as a visitor types**, and **turn-by-turn directions** inside the
  page. The directions link hands the route to OpenStreetMap instead.
- **Satellite imagery.**
- **Google Maps.** Its terms forbid showing its places and addresses on any
  other map, and it needs a key and a Google Cloud account of the person's own.
