import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import {
  type Dir,
  locatedItem,
  type Near,
  near,
  noted,
  placed,
  placeSet,
  type Reading,
} from './located.ts'

let now = Date.parse('2026-11-23T12:00:00Z')
let days = (n: number) => new Date(now - n * 86_400_000).toISOString()

let phone: Reading = {
  kind: 'home',
  source: 'phone',
  country: 'US',
  area: '269',
}
let billing: Reading = {
  kind: 'home',
  source: 'billing',
  city: 'Portage',
  region: 'MI',
  country: 'US',
}
let said = (more: Partial<Reading> = {}): Reading => ({
  kind: 'home',
  source: 'said',
  city: 'Kalamazoo',
  region: 'MI',
  country: 'US',
  ...more,
})
let network = (more: Partial<Reading> = {}): Reading => ({
  kind: 'current',
  source: 'network',
  city: 'Chicago',
  region: 'IL',
  country: 'US',
  zone: 'America/Chicago',
  at: days(0),
  ...more,
})

// Each part's value as it was chosen, by place.
let values = (readings: Reading[]) =>
  Object.fromEntries(
    placed(readings, now).map(({ kind, ...parts }) => [
      kind,
      Object.fromEntries(
        Object.entries(parts).map(([k, g]) => [k, `${g.value} ${g.source}`]),
      ),
    ]),
  )

test('their own words outrank billing, phone and connection', () => {
  equal(values([phone, billing, said()]).home, {
    city: 'Kalamazoo said',
    region: 'MI said',
    country: 'US said',
    area: '269 phone',
  })
  equal(values([phone, billing]).home, {
    city: 'Portage billing',
    region: 'MI billing',
    country: 'US billing',
    area: '269 phone',
  })
})

test('a weaker source fills in only where it agrees', () => {
  let abroad = said({ city: 'Lyon', region: 'ARA', country: 'FR' })
  equal(values([abroad, phone, billing]).home, {
    city: 'Lyon said',
    region: 'ARA said',
    country: 'FR said',
  })
  let ohio = {
    ...billing,
    city: 'Toledo',
    region: 'OH',
    zone: 'America/New_York',
  }
  equal(values([said({ zone: undefined }), ohio]).home.zone, undefined)
})

test('their word on where they are now yields to a newer connection once stale', () => {
  let there = said({
    kind: 'current',
    city: 'Tokyo',
    region: '13',
    country: 'JP',
  })
  equal(
    values([{ ...there, at: days(1) }, network()]).current.city,
    'Tokyo said',
  )
  equal(
    values([{ ...there, at: days(4) }, network()]).current.city,
    'Chicago network',
  )
})

test('places come home, work, current, then named', () => {
  let rows = [
    network(),
    said({ kind: 'the cabin' }),
    said({ kind: 'work' }),
    phone,
  ]
  equal(placed(rows, now).map((p) => p.kind), [
    'home',
    'work',
    'current',
    'the cabin',
  ])
})

let nearOf = (readings: Reading[]): Near | undefined =>
  near(placed(readings, now))

test('a number is looked for near home, else work, else now', () => {
  equal(nearOf([phone]), {
    area: '269',
    why: 'near area code 269 (home, from your phone)',
  })
  // Their word on a city outranks their phone's area code.
  equal(nearOf([phone, said()]), {
    state: 'MI',
    city: 'Kalamazoo',
    why: 'near Kalamazoo, MI (home, as you said)',
    wider: 'near MI (home, as you said)',
  })
  // A phone's area code outranks a connection.
  equal(nearOf([phone, network()])?.area, '269')
  equal(nearOf([network()]), {
    state: 'IL',
    city: 'Chicago',
    why: 'near Chicago, IL (where you are now, from your connection)',
    wider: 'near IL (where you are now, from your connection)',
  })
  equal(nearOf([said({ kind: 'work', city: undefined }), network()]), {
    state: 'MI',
    why: 'near MI (work, as you said)',
  })
  // A place abroad has no area to search; the next one is used.
  equal(
    nearOf([said({ country: 'FR', region: 'ARA', city: 'Lyon' }), network()])
      ?.state,
    'IL',
  )
  equal(nearOf([]), undefined)
})

test('a connection saying the same within the day writes nothing', () => {
  let was = network({ at: new Date(now - 3_600_000).toISOString() })
  equal(noted(was, 'ada', network(), now), undefined)
  equal(!!noted(was, 'ada', network({ city: 'Evanston' }), now), true)
  equal(!!noted(network({ at: days(2) }), 'ada', network(), now), true)
  equal(!!noted(said(), 'ada', said(), now), true)
  equal(
    noted(undefined, 'ada', { kind: 'home', source: 'billing' }, now),
    undefined,
  )
})

// A directory holding one person's rows, answering the reads located.ts makes.
let directory = (phone?: string) => {
  let rows = new Map<string, Bundle>()
  let dir: Dir = {
    read: (q) => {
      let eid = /\.entity\.eid=([^&]+)/.exec(decodeURIComponent(q))?.[1]
      if (q.includes('phone.number')) {
        return phone
          ? [{ entity: { eid: 'ada' }, phone: { number: phone } }]
          : []
      }
      if (eid) return rows.has(eid) ? [rows.get(eid)!] : []
      return [...rows.values()]
    },
    apply: (bundles) => {
      for (let b of bundles) {
        if (b.$delete) rows.delete(b.entity.eid)
        else rows.set(b.entity.eid, b)
      }
    },
  }
  return dir
}

test('their correction wins, and the Operator is told where they are', async () => {
  let dir = directory('+12695550142')
  let set = placeSet(() => dir, 'ada')
  equal(
    await locatedItem(dir, 'ada', now),
    'Where the person you are talking with is, roughly, for them alone: ' +
      'where they are now for "near me", the weather and their time, home or ' +
      'work for a local number. Never tell it to anyone else; place_set ' +
      'corrects it when they say otherwise. home: US, area code 269 (their phone)',
  )
  equal(
    await set.run({
      kind: 'Home',
      city: 'Kalamazoo',
      region: 'mi',
      country: 'us',
    }),
    'home: Kalamazoo, MI, US (they said, 1m ago); area code 269 (their phone)',
  )
  equal(
    await set.run({ kind: 'home', forget: true }),
    'home: US, area code 269 (their phone)',
  )
  equal(await locatedItem(directory(), 'ada', now), undefined)
})
