/**
 * Finding where a place is from its name or address, once: the lookup an
 * Operator makes while writing an app, never a page while someone visits it.
 * A geocoder is a row of data (`geocoder{name, search, interval,
 * attribution}`, nominatim.json first), and every answer it gives is kept as
 * `geocode{provider, query, lat, lng, address, at}`, its eid derived from the
 * provider and the words (`geocodeEid`), so the same words never reach it
 * twice. An answer that found nothing is kept too.
 *
 * Nominatim's usage policy (operations.osmfoundation.org/policies/nominatim)
 * asks for at most one request a second, an identifying User-Agent, cached
 * results and OSM's credit: `interval` paces each host's calls, `AGENT`
 * names yaks.app, the kept rows are the cache, and `attribution` goes with
 * every answer. Google's geocoder is not one of these: its terms forbid its
 * results on a non-Google map (D-482).
 *
 * The host supplies the effects: `fetch`, and where answers are kept.
 *
 * @module
 */
import { identityEid } from '@yaks/graph/identity'
import type { Geocoder } from './providers.ts'

/** One kept answer: where the words found, or no `address` when they found
 * nothing. */
export type Geocode = {
  provider: string
  query: string
  lat?: number
  lng?: number
  address?: string
  at: string
}

/** What a host lends a lookup: where answers are kept and read, and how it
 * calls out. `now` and `sleep` are the clock, for pacing. */
export type Lookups = {
  read: (provider: string, query: string) => Promise<Geocode | null>
  keep: (answer: Geocode) => Promise<void>
  fetch: (req: Request) => Promise<Response>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Who yaks.app says it is to a geocoder. */
export let AGENT = 'yaks.app maps (+https://yaks.app)'

/** The words as a lookup keeps them: trimmed, one space apart, lower-case,
 * so `" Loved First  School"` and `"loved first school"` are one answer.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { queryOf } from '@yaks/maps/lookup'
 * assertEquals(queryOf('  Loved First\n School '), 'loved first school')
 * ```
 */
export let queryOf = (words: string): string =>
  words.trim().replace(/\s+/g, ' ').toLowerCase()

/** The eid an answer is kept under. */
export let geocodeEid = (provider: string, query: string): string =>
  identityEid('geocode', [provider, queryOf(query)])

/** The address a geocoder is asked the words at.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { askAt } from '@yaks/maps/lookup'
 * import { GEOCODERS } from '@yaks/maps'
 * assertEquals(
 *   askAt(GEOCODERS.nominatim, 'masooli, uganda'),
 *   'https://nominatim.openstreetmap.org/search?q=masooli%2C%20uganda' +
 *     '&format=jsonv2&limit=1&accept-language=en',
 * )
 * ```
 */
export let askAt = (g: Geocoder, query: string, lang = 'en'): string =>
  g.search.replaceAll('{query}', encodeURIComponent(query))
    .replaceAll('{lang}', encodeURIComponent(lang))

/** What a geocoder's answer says: its first place, or nothing. Nominatim's
 * `jsonv2` is a list of places, each with `lat`, `lon` and `display_name`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { placeOf } from '@yaks/maps/lookup'
 * assertEquals(
 *   placeOf([{ lat: '0.43', lon: '32.58', display_name: 'Masooli, Uganda' }]),
 *   { lat: 0.43, lng: 32.58, address: 'Masooli, Uganda' },
 * )
 * assertEquals(placeOf([]), null)
 * ```
 */
export let placeOf = (
  body: unknown,
): { lat: number; lng: number; address: string } | null => {
  let first = Array.isArray(body) ? body[0] : null
  let lat = Number(first?.lat), lng = Number(first?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng, address: String(first.display_name ?? '') }
}

/** How long to wait before the next call to a geocoder last called at
 * `last`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { pace } from '@yaks/maps/lookup'
 * assertEquals(pace(1000, 1400, 1000), 600)
 * assertEquals(pace(1000, 2500, 1000), 0)
 * ```
 */
export let pace = (last: number, now: number, interval: number): number =>
  Math.max(0, last + interval - now)

// When each geocoder was last called from this isolate: a time, not a
// promise, so no request waits on another's.
let called: Record<string, number> = {}

/** Where `words` are, as `geocoder` answers: the kept answer when there is
 * one, else the geocoder's, kept before it is answered. */
export let lookup = async (
  geocoder: Geocoder,
  words: string,
  host: Lookups,
  lang = 'en',
): Promise<Geocode> => {
  let query = queryOf(words)
  if (!query) throw new Error('lookup: say what to look for')
  let had = await host.read(geocoder.name, query)
  if (had) return had
  let now = host.now ?? Date.now
  let wait = pace(called[geocoder.name] ?? 0, now(), geocoder.interval)
  if (wait) {
    await (host.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms))))(
      wait,
    )
  }
  called[geocoder.name] = now()
  let res = await host.fetch(
    new Request(askAt(geocoder, query, lang), {
      headers: { 'user-agent': AGENT, accept: 'application/json' },
    }),
  )
  if (!res.ok) {
    await res.body?.cancel()
    throw new Error(`lookup: ${geocoder.title} answered ${res.status}`)
  }
  let place = placeOf(await res.json())
  let answer: Geocode = {
    provider: geocoder.name,
    query,
    ...place,
    at: new Date(now()).toISOString(),
  }
  await host.keep(answer)
  return answer
}
