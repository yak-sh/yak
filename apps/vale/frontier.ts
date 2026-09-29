// The country beyond the named lands. A cell's coordinates alone choose its
// name, terrain family and places, so every page grows the same frontier.
import { isA } from './features.ts'
import type { Level, Place } from './levels.ts'
import { fbm, hash, rand } from './rand.ts'

let THEMES = [
  'fernwood',
  'heatherfell',
  'sporefen',
  'saltreach',
  'redmesa',
  'frostmoor',
  'gleamdeep',
  'cinderreach',
]
let ROOTS = [
  'Alder',
  'Ashen',
  'Black',
  'Briar',
  'Copper',
  'Dusk',
  'Elder',
  'Ember',
  'Fern',
  'Fox',
  'Glimmer',
  'Grey',
  'Hollow',
  'Iron',
  'Moss',
  'Raven',
  'Red',
  'Rime',
  'Silver',
  'Star',
  'Storm',
  'Sun',
  'Thorn',
  'White',
  'Willow',
  'Wolf',
]
let ENDS = [
  'bank',
  'bloom',
  'break',
  'brook',
  'cliff',
  'deep',
  'fell',
  'fen',
  'field',
  'fold',
  'glen',
  'grove',
  'hollow',
  'mere',
  'moor',
  'reach',
  'ridge',
  'run',
  'scar',
  'shade',
  'strand',
  'vale',
  'watch',
  'wood',
]

export let frontierId = (gx: number, gz: number) => `frontier_${gx}_${gz}`
export let frontierCell = (id: string): [number, number] | null => {
  let match = /^frontier_(-?\d+)_(-?\d+)$/.exec(id)
  if (!match) return null
  let gx = Number(match[1]), gz = Number(match[2])
  return Number.isSafeInteger(gx) && Number.isSafeInteger(gz) &&
      Math.max(Math.abs(gx), Math.abs(gz)) < 100000
    ? [gx, gz]
    : null
}

let place = (p: Place, gx: number, gz: number, n: number): Place => ({
  kind: p.kind,
  at: [
    Math.max(
      24,
      Math.min(232, p.at[0] + Math.round((rand(gx, gz, n) - 0.5) * 24)),
    ),
    Math.max(
      24,
      Math.min(232, p.at[1] + Math.round((rand(gx, gz, n + 71) - 0.5) * 24)),
    ),
  ],
})

/** A region's stable row. The authored land supplies a coherent family of
 * ground and creatures; its named settlements are replaced by wilderness. */
export let frontier = (
  gx: number,
  gz: number,
  known: Record<string, Level>,
  hops: Record<string, number>,
): Level => {
  let salt = hash(gx, gz, 40841)
  let theme = THEMES[
    Math.min(
      THEMES.length - 1,
      Math.floor(fbm(gx / 3, gz / 3, 40841, 3) * THEMES.length),
    )
  ]
  let model = known[theme]
  let places = Object.fromEntries(
    Object.entries(model.places)
      .filter(([, p]) => !isA(p.kind, 'village'))
      .map(([name, p], i) => [name, place(p, gx, gz, i + 1)]),
  )
  let landmark = hash(gx, gz, 40843) % 4
  if (landmark < 2) {
    let sites: [number, number][] = [
      [64, 64],
      [192, 64],
      [64, 192],
      [192, 192],
    ]
    let nearest = ([x, z]: [number, number]) =>
      Math.min(
        ...Object.values(places).map((p) =>
          Math.hypot(x - p.at[0], z - p.at[1])
        ),
      )
    let at = sites.sort((a, b) => nearest(b) - nearest(a))[0]
    places[landmark ? 'valley' : 'castle'] = {
      kind: landmark ? 'valley' : 'castle',
      at,
    }
  }
  let arrive = places[model.arrive] ? model.arrive : Object.keys(places)[0]
  return {
    id: frontierId(gx, gz),
    name: ROOTS[salt % ROOTS.length] +
      ENDS[hash(gx, gz, 40842) % ENDS.length],
    seed: salt,
    cell: [gx, gz],
    arrive,
    places,
    roads: {},
    habitat: hops[theme],
    wild: model.wild,
    look: model.look,
  }
}
