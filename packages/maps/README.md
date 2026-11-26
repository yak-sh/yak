# @yaks/maps

Maps of OpenStreetMap data in an app's own colours. Every provider is a row of
data rather than code: the tiles a map is drawn from, and the geocoder that
finds where a place is. Switching a host's provider changes which row it names,
and no app.

## Providers

A **tile provider** is
`map_tiles{name, title, archive, glyphs, style,
attribution, max_zoom, builds}`.
One with `archive` is a PMTiles file in the host's bucket, which the host serves
with the door below; `glyphs` is the key prefix of its label fonts, and `builds`
where a fresh build is downloaded from. One with `style` is a MapLibre style
another site hosts and serves tiles for. The package ships two as JSON
(`TILES`):

- `protomaps` (`TILES_DEFAULT`): Protomaps' daily planet build, about 140 GB,
  zoom 0 to 15, served by yaks.app from its own bucket (D-482, T-3944).
- `openfreemap`: OpenFreeMap's public Liberty style, drawn in their look.

A **geocoder** is `geocoder{name, title, search, interval, attribution}`: the
address it is asked at, with `{query}` and `{lang}`, the fewest milliseconds
between two calls, and the credit owed with its answers. `GEOCODERS.nominatim`
is OpenStreetMap's. Its usage policy allows one request a second for a whole
application and asks that results be kept, so a lookup is made once, while an
app is written, and never by a page.

## The tile door

`serve(req, path, door)` from `@yaks/maps/tiles` answers a path under the door's
mount: `/tiles.json` (TileJSON), `/{z}/{x}/{y}.mvt` (one tile, 204 where the
archive has none) and `/fonts/{fontstack}/{range}.pbf`. The host hands it the
provider, a bucket (@yaks/blob's `get`, which an R2 bucket answers), the address
it is mounted at, and where it has them a cache (the Cache API's `match` and
`put`) and a way to finish the cache write after answering. Every answer allows
any origin. The archive's header and directories are kept for the isolate as
values, never promises, and for an hour at most, so a refreshed archive is read
again.

yaks.app mounts it at `https://yaks.app/maps` (workers/yak/maps.ts).

## Styles and themes

`style(provider, theme, base, lang?)` from `@yaks/maps/style` is the MapLibre
style for an archive provider in a theme, its tiles and fonts read from the door
at `base`, or the style address of a provider another site hosts. A `Theme` is
the kit theme's colours resolved: `bg`, `surface`, `border`, `text`, `muted`,
`accent`, and `font`. `flavor(theme)` makes the Protomaps flavor: land is `bg`,
water and parks are tints of it toward blue and green, roads are `border`, place
names `text` and `muted` over a halo of `bg`. The style draws no icons, since
Protomaps' sprites are coloured per flavor: points of interest are left out, and
a shield or a town's dot is drawn as its words.

`themeOf(el)` from `@yaks/maps/theme` reads the theme in force at an element of
a page, each custom property resolved to `#rrggbb` as the page draws it, so
`light-dark()` and `oklch()` arrive as the colour the person sees.

## Drawing

`<Place at label zoom directions>` (`@yaks/maps/Place`) is one place on a still
map, with a pin in the accent colour, its label, the credit and a directions
link to OpenStreetMap's planner. `<Map center zoom pins title>`
(`@yaks/maps/Map`) is a map a person moves, with a pin for each `{at, label}`
given; it moves with two fingers or a modifier key, so a page scrolls past it.
Both hand the MapLibre map to `onMap` once drawn. `at` and `center` are
`[longitude, latitude]`. `draw(el, drawing)` from `@yaks/maps/draw` is what both
are made of. MapLibre is imported only when a page draws its first map, and the
few rules it needs are put in the page then, with the frame's, as one `<style>`.

Apps name it `"@yaks/maps": "platform"` in package.json; yaks.app's guide page
is workers/yak/public/docs/maps.md.

## Lookups

`lookup(geocoder, words, host, lang?)` from `@yaks/maps/lookup` answers where
the words are: the kept answer when there is one, else the geocoder's, kept
before it is answered, nothing found included. An answer is
`geocode{provider, query, lat, lng, address, at}`, its eid derived from the
provider and the words as `queryOf` writes them (`geocodeEid`). The host lends
`read`, `keep` and `fetch`. Calls to a geocoder from one isolate are paced by
its `interval`. yaks.app keeps the answers in its directory and asks through the
`place_find` tool (workers/yak/places.ts).

## Refreshing the archive

```sh
deno run -A packages/maps/refresh.ts [provider] [--date YYYYMMDD] [--fonts-only]
```

copies the label fonts from protomaps/basemaps-assets and the provider's newest
build (today's, or the newest of the week before) into the `yak-maps` bucket
with rclone. The archive is a multipart upload that replaces the object only
once it is whole. The S3 credentials are the box's vault secrets
`MAPS_R2_ACCESS_KEY_ID` and `MAPS_R2_SECRET_ACCESS_KEY`, a token for that bucket
alone, handed to rclone in its environment.

## Testing

`@yaks/maps/testing` makes a PMTiles archive from a few tiles (`archive`) and a
bucket in memory that counts its reads (`bucket`).
