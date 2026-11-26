// Where a place is, for an app's map: `place_find` asks a geocoder once
// (@yaks/maps/lookup, Nominatim first) and keeps every answer in the
// directory as `geocode{provider, query, lat, lng, address, at}`, so the same
// words never reach the geocoder twice, from any space. The Operator looks a
// place up while writing an app and writes the point into the app; a page
// never calls a geocoder (D-482).
import { line } from '@yaks/query'
import { GEOCODERS } from '@yaks/maps/providers'
import { type Geocode, geocodeEid, lookup } from '@yaks/maps/lookup'
import { KERNEL, meta } from './meta.ts'
import type { Env } from './env.ts'
import { type Args, inSpace, refuse, SPACE, str } from './tool.ts'
import type { Row } from './tool-words.ts'

let GEOCODER = GEOCODERS.nominatim

/** The directory as a lookup keeps its answers there. */
let kept = (env: Env) => ({
  read: async (provider: string, query: string) => {
    let eid = geocodeEid(provider, query)
    let [row] = await meta(env).query(line`.entity.eid=${eid}&.geocode`)
    return (row?.geocode as Geocode | undefined) ?? null
  },
  keep: async (answer: Geocode) => {
    await meta(env).apply([{
      entity: { eid: geocodeEid(answer.provider, answer.query) },
      geocode: answer,
    }], KERNEL)
  },
  fetch: (req: Request) => fetch(req),
})

/** An answer as the tool says it: the point, in the order `<Place at>`
 * takes it, and the credit the geocoder asks for.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { said } from './places.ts'
 * assertEquals(
 *   said({ provider: 'nominatim', query: 'x', lat: 1.3, lng: 32.4, address: 'X', at: '' }),
 *   'X\nlat 1.3, lng 32.4: <Place at={[32.4, 1.3]} />\n' +
 *     'Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright',
 * )
 * ```
 */
export let said = (g: Geocode): string =>
  g.lat == null || g.lng == null
    ? `${GEOCODER.title} found nothing for "${g.query}". Try the town and ` +
      'country, or a street address.'
    : `${g.address}\nlat ${g.lat}, lng ${g.lng}: ` +
      `<Place at={[${g.lng}, ${g.lat}]} />\n${GEOCODER.attribution}`

/** The place tools, worded in tools.yml. */
export let placeTools: Row[] = [{
  name: 'place_find',
  readOnly: true,
  openWorld: true,
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      query: str(
        'the place: a name, an address, or a town and its country, such as ' +
          'Nakasongola, Uganda',
      ),
      lang: str('the language the answer names the place in, en by default'),
    },
    required: ['query'],
  },
  run: async (ctx, args: Args) => {
    let { space } = await inSpace(ctx, args)
    let query = typeof args.query == 'string' ? args.query.trim() : ''
    if (!query) throw refuse('arguments', 'query: say which place to find')
    let lang = typeof args.lang == 'string' && args.lang.trim() || 'en'
    let answer = await lookup(GEOCODER, query, kept(ctx.env), lang)
    return { text: said(answer), space }
  },
}]
