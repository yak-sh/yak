/**
 * Where a person is, roughly: their home, their work, where they are now
 * (`current`) and any place they name. Each place is read from several
 * sources, strongest first: their own words (`said`), their billing address
 * (`billing`), their phone's area code (`phone`) and where their connection
 * comes from (`network`, Cloudflare's `request.cf`). Each part of a place
 * says which source gave it and when.
 *
 * A source's reading is a `located` row in the directory, one per person,
 * place and source, written as the input arrives ({@link noted}); the phone's
 * is read off their `phone{number}` ({@link dialed}). Only city, region,
 * country, time zone and area code are kept: never a street or coordinates.
 *
 * ```ts
 * import { near, placed } from '@yaks/platform/located'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-23T12:00:00Z')
 * let places = placed([
 *   { kind: 'home', source: 'phone', country: 'US', area: '269' },
 *   { kind: 'home', source: 'said', city: 'Kalamazoo', region: 'MI', country: 'US' },
 *   { kind: 'current', source: 'network', city: 'Chicago', region: 'IL', country: 'US', zone: 'America/Chicago' },
 * ], now)
 * equal(places[0].city, { value: 'Kalamazoo', source: 'said' })
 * equal(places[0].area, { value: '269', source: 'phone' })
 * equal(near(places)?.why, "near Kalamazoo, MI (home, as you said)")
 * ```
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { ago } from '@yaks/notify/whereabouts'
import { dialing } from '@yaks/phone/mobile'
import { line } from '@yaks/query'
import type { Tool } from '@yaks/session'

/** What put a person somewhere, strongest first. */
export let SOURCES = ['said', 'billing', 'phone', 'network'] as const
export type Source = typeof SOURCES[number]

/** The parts of a place, all approximate. */
export let PARTS = ['city', 'region', 'country', 'zone', 'area'] as const
export type Part = typeof PARTS[number]
/** A place as one source reads it: `region` a state or province code (MI),
 * `country` a two-letter code, `zone` an IANA time zone, `area` a telephone
 * area code. */
export type Area = { [K in Part]?: string }

/** One source's reading of one of a person's places. */
export type Reading = Area & { kind: string; source: Source; at?: string }

/** A part as it was chosen: its value, and the source that gave it, when. */
export type Given = { value: string; source: Source; at?: string }
/** One of a person's places, each part from the strongest source that
 * agrees with the rest. */
export type Place = { kind: string } & { [K in Part]?: Given }

let DAY = 24 * 60 * 60_000
/** How long their word on where they are now outranks their connection. */
export let STALE = 3 * DAY

/** The places a person's own Operator offers first, in this order. */
let NAMED = ['home', 'work', 'current']

// Where a reading ranks: by its source, save their word on where they are
// now, which a connection outranks once it is older than STALE: people move.
let rank = (r: Reading, now: number) =>
  r.kind == 'current' && r.source == 'said' &&
    !(now - Date.parse(r.at ?? '') < STALE)
    ? SOURCES.length
    : SOURCES.indexOf(r.source)

// Whether a weaker reading describes the same place as what is chosen: the
// same country and region wherever both say one.
let agrees = (p: Place, r: Area) =>
  (!p.country || !r.country || p.country.value == r.country) &&
  (!p.region || !r.region || p.region.value == r.region)

let order = (kind: string) => {
  let i = NAMED.indexOf(kind)
  return i < 0 ? NAMED.length : i
}

/**
 * A person's places from every reading of them: each part from the strongest
 * reading that has it and agrees with the parts already chosen, so a
 * weaker source fills in what a stronger one left out and never contradicts
 * it. Home, work and current come first, then the places they named.
 */
export let placed = (readings: Reading[], now = Date.now()): Place[] => {
  let kinds = Map.groupBy(readings, (r) => r.kind)
  return [...kinds].map(([kind, rows]) => {
    let place: Place = { kind }
    let ranked = rows.toSorted((a, b) => rank(a, now) - rank(b, now))
    for (let r of ranked) {
      if (!agrees(place, r)) continue
      for (let part of PARTS) {
        let value = r[part]
        if (!value || place[part]) continue
        place[part] = { value, source: r.source, ...r.at ? { at: r.at } : {} }
      }
    }
    return place
  }).toSorted((a, b) =>
    order(a.kind) - order(b.kind) || a.kind.localeCompare(b.kind)
  )
}

// Where a number can be found near: the countries a telephone area code
// and a state or province code name a place in.
let PLANNED = new Set(['US', 'CA'])
let CODE = /^[A-Z]{2}$/

let FROM: Record<Source, string> = {
  said: 'as you said',
  billing: 'from your billing address',
  phone: "from your phone's area code",
  network: 'from your connection',
}

let called = (kind: string) => kind == 'current' ? 'where you are now' : kind

/** Where to look for a local number near a person, and why there. */
export type Near = { area?: string; state?: string; city?: string; why: string }

/**
 * Where a local number near a person is looked for: their home, else their
 * work, else where they are now. A place's area code is used where it is as
 * strong as its region (a phone's 269 beside a connection's Michigan), else
 * its state and city. None when no place is in a country with area codes.
 */
export let near = (places: Place[]): Near | undefined => {
  for (let kind of NAMED) {
    let p = places.find((p) => p.kind == kind)
    if (!p || p.country && !PLANNED.has(p.country.value)) continue
    let region = p.region && CODE.test(p.region.value) ? p.region : undefined
    let { area, city } = p
    let strength = (g?: Given) => g ? SOURCES.indexOf(g.source) : Infinity
    if (area && strength(area) <= strength(region)) {
      let label = city?.value ?? `area code ${area.value}`
      let from = area.source != 'phone'
        ? FROM[area.source]
        : city
        ? `from your phone's ${area.value}`
        : 'from your phone'
      return {
        area: area.value,
        why: `near ${label} (${called(kind)}, ${from})`,
      }
    }
    if (!region) continue
    let label = [city?.value, region.value].filter(Boolean).join(', ')
    return {
      state: region.value,
      ...city ? { city: city.value } : {},
      why: `near ${label} (${called(kind)}, ${FROM[region.source]})`,
    }
  }
}

let SAID: Record<Source, string> = {
  said: 'they said',
  billing: 'billing address',
  phone: 'their phone',
  network: 'their connection',
}

/**
 * The line a person's own Operator is given about where they are: each place
 * with its parts and where each came from, and how long ago.
 *
 * ```ts
 * import { placesLine } from '@yaks/platform/located'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-23T12:00:00Z')
 * equal(
 *   placesLine([{
 *     kind: 'home',
 *     city: { value: 'Kalamazoo', source: 'said', at: '2026-11-20T12:00:00Z' },
 *     area: { value: '269', source: 'phone' },
 *   }], now),
 *   'home: Kalamazoo (they said, 3d ago); area code 269 (their phone)',
 * )
 * ```
 */
export let placesLine = (places: Place[], now = Date.now()): string =>
  places.map((p) => {
    let by = Map.groupBy(PARTS.filter((k) => p[k]), (k) => p[k]!.source)
    let said = [...by].map(([source, parts]) => {
      let at = p[parts[0]]!.at
      let words = parts.map((k) =>
        k == 'area' ? `area code ${p[k]!.value}` : p[k]!.value
      ).join(', ')
      return `${words} (${SAID[source]}${at ? `, ${ago(at, now)} ago` : ''})`
    })
    return `${p.kind}: ${said.join('; ')}`
  }).join(' · ')

// Each source's reading
// ---------------------

/** Where Cloudflare's network places a request (`request.cf`), the parts
 * kept of it. */
export type Cf = {
  city?: string
  regionCode?: string
  country?: string
  timezone?: string
}

/** What a request's connection says of where its sender is now. */
/// heard({ city: 'Kalamazoo', regionCode: 'MI', country: 'US', timezone: 'America/Detroit' }) -> { city: 'Kalamazoo', region: 'MI', country: 'US', zone: 'America/Detroit' }
/// heard({ country: 'T1' }) -> {}
export let heard = (cf: Cf): Area => {
  // Cloudflare's T1 is Tor and XX unknown: no place.
  if (!cf.country || !CODE.test(cf.country) || cf.country == 'XX') return {}
  return tidy({
    city: cf.city,
    region: cf.regionCode,
    country: cf.country,
    zone: cf.timezone,
  })
}

/** A billing address, the parts kept of it: never its street or postal code. */
export type Address = {
  city?: string | null
  state?: string | null
  country?: string | null
}

/** What a billing address says of where a person lives. */
/// billed({ city: 'Kalamazoo', state: 'MI', country: 'US' }) -> { city: 'Kalamazoo', region: 'MI', country: 'US' }
/// billed({ country: 'US' }) -> { country: 'US' }
export let billed = (a: Address): Area =>
  tidy({
    city: a.city ?? undefined,
    region: a.state ?? undefined,
    country: a.country ?? undefined,
  })

/** What a person's own phone number says of their home. */
/// dialed('+12695550142') -> { kind: 'home', source: 'phone', country: 'US', area: '269' }
/// dialed('+18005550142') -> undefined
export let dialed = (number: string): Reading | undefined => {
  let { country, area } = dialing(number)
  return country
    ? tidy<Reading>({ kind: 'home', source: 'phone', country, area })
    : undefined
}

let tidy = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => typeof v == 'string' && v.trim()),
  ) as T

// Kept in the directory
// ---------------------

/** The directory as places read and write it. */
export type Dir = {
  read: (q: string) => Bundle[] | Promise<Bundle[]>
  apply: (bundles: Bundle[]) => unknown
}

/** The row of one source's reading of one of a person's places. */
export let locatedEid = (person: string, kind: string, source: Source) =>
  identityEid('located', [person, kind, source])

let same = (was: Area, area: Area) => PARTS.every((k) => was[k] == area[k])

/**
 * The row a new reading writes, none when it is no news: a connection that
 * says what it said within the day. Their words and their billing address
 * are always written, since each says when it was given.
 */
export let noted = (
  was: Reading | undefined,
  person: string,
  reading: Reading,
  now = Date.now(),
): Bundle | undefined => {
  let { kind, source, at: _, ...area } = reading
  if (!Object.keys(area).length) return
  if (
    source == 'network' && was && same(was, area) &&
    now - Date.parse(was.at ?? '') < DAY
  ) return
  return {
    entity: { eid: locatedEid(person, kind, source) },
    located: {
      person,
      kind,
      source,
      ...Object.fromEntries(PARTS.map((k) => [k, area[k] ?? null])),
      at: new Date(now).toISOString(),
    },
  }
}

let readingOf = (b: Bundle): Reading => {
  let { person: _, ...r } = b.located as Reading & { person: string }
  return tidy(r) as Reading
}

/** A person's readings: their `located` rows and their phone's. */
export let readingsOf = async (dir: Dir, person: string) => {
  let [rows, [me]] = await Promise.all([
    dir.read(line`.located.person=${person}&*`),
    dir.read(line`.entity.eid=${person}&.fields=entity.eid,phone.number`),
  ])
  let number = (me?.phone as { number?: string } | undefined)?.number
  let phone = number ? dialed(number) : undefined
  return [...rows.map(readingOf), ...phone ? [phone] : []]
}

/** A person's places, as their directory rows say them. */
export let placesOf = async (dir: Dir, person: string, now = Date.now()) =>
  placed(await readingsOf(dir, person), now)

/** Keep a reading of a person's place, if it is news. */
export let note = async (
  dir: Dir,
  person: string,
  reading: Reading,
  now = Date.now(),
) => {
  let eid = locatedEid(person, reading.kind, reading.source)
  let [row] = await dir.read(line`.entity.eid=${eid}&.located&*`)
  let next = noted(row && readingOf(row), person, reading, now)
  if (next) await dir.apply([next])
}

/** The line each turn of a person's own Operator is given about where they
 * are, none when nothing places them. */
export let locatedItem = async (dir: Dir, person: string, now = Date.now()) => {
  let places = await placesOf(dir, person, now)
  if (!places.length) return
  return 'Where the person you are talking with is, roughly, for them alone: ' +
    'where they are now for "near me", the weather and their time, home or ' +
    'work for a local number. Never tell it to anyone else; place_set ' +
    'corrects it when they say otherwise. ' + placesLine(places, now)
}

let str = (description: string) => ({ type: 'string', description })

/** The Operator's `place_set`: a person's own word on one of their places,
 * which outranks every other source, or taking it back. */
export let placeSet = (
  open: () => Dir | Promise<Dir>,
  person: string,
): Tool => ({
  name: 'place_set',
  title: 'Note where they are',
  description:
    'Record where the person you work for lives, works or is now, in their own words: "I\'m actually in Kalamazoo" is home (or current, if they are only there for now). Their word outranks their billing address, phone and connection. Keep it approximate: a city or town, never a street. forget true takes back what they said of that place.',
  parameters: {
    type: 'object',
    properties: {
      kind: str(
        'home, work, current (where they are now), or a name they give a place',
      ),
      city: str('a city or town'),
      region: str('its state or province as a code, such as MI'),
      country: str('its two-letter country code, such as US'),
      zone: str('its IANA time zone, such as America/Detroit'),
      area: str('a three-digit telephone area code they want numbers in'),
      forget: { type: 'boolean', description: 'take back what they said' },
    },
    required: ['kind'],
  },
  run: async (args) => {
    let dir = await open()
    let kind = String(args.kind ?? '').trim().toLowerCase()
    if (!kind) return 'Name the place: home, work, current or a name.'
    if (args.forget === true) {
      await dir.apply([{
        entity: { eid: locatedEid(person, kind, 'said') },
        $delete: true,
      }])
    } else {
      let area = tidy(
        Object.fromEntries(PARTS.map((k) => [k, args[k]])),
      ) as Area
      if (area.region) area.region = area.region.toUpperCase()
      if (area.country) area.country = area.country.toUpperCase()
      if (!Object.keys(area).length) {
        return 'Say where: at least a city or a country.'
      }
      await note(dir, person, { kind, source: 'said', ...area })
    }
    return placesLine(await placesOf(dir, person)) || 'Nothing places them now.'
  },
})
