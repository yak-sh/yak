/**
 * The place a request came from, in words a person knows it by, as
 * Cloudflare's network reads it.
 *
 * @module
 */
import { once } from '@yaks/fp'

/** Where a request came from, as Cloudflare's network reads it. */
export type Whereabouts = { city?: string; region?: string; country?: string }

// Built when a place is first named: a store that names none builds none.
let countries = once(() => new Intl.DisplayNames(['en'], { type: 'region' }))

/**
 * A city and its region at home, or its country abroad: `Portland, Oregon`,
 * `Berlin, Germany`. Empty where the network says nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { placeOf } from '@yaks/platform/place'
 * assertEquals(placeOf({ city: 'Berlin', country: 'DE' }), 'Berlin, Germany')
 * assertEquals(placeOf({}), '')
 * ```
 */
export let placeOf = ({ city, region, country }: Whereabouts): string => {
  let wide = country == 'US'
    ? region
    : country && (countries().of(country) ?? country)
  return [city, wide].filter(Boolean).join(', ')
}
