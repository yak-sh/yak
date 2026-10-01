// One creature an owner puts at a spot with /spawn: which creature a word
// names, the row the worker writes for it, and the home a page grows from
// that row. A spawned creature is one stored row, `spawned{beast, lvl, x, z,
// roam}` with its `place`, because nothing else could derive it; a den's
// creatures are derived on every page instead (homes.ts). The row's eid is
// the creature's, so the slain row that names it keeps it down for good.
import { placeOf } from './area.ts'
import { comp } from './bundle.ts'
import type { Home } from './homes.ts'
import type { Bundle } from './net.ts'
import { QUESTS } from './quests.ts'
import { hashOf } from './rand.ts'
import { entriesOf, killsOf, levelOf, xpOf } from './rules.ts'

/** How far a spawned creature wanders from where it was put, in metres. */
export let ROAM = 6

// A name as the commands compare names, case and punctuation aside
// (target.ts).
let plain = (text: string) =>
  text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/**
 * The creature a word names, by eid: its eid, its alias (beast:boar), the
 * alias's last word (boar), or its name (Bristleboar). `beasts` are the
 * store's `beast_design` rows and `keys` its alias keys, `key{of, value}`.
 * Nothing when no creature answers; a word two creatures answer to throws,
 * since the alias tells them apart.
 *
 * ```ts
 * import { assertEquals, assertThrows } from '@std/assert'
 * let beasts = [
 *   { entity: { eid: 'b1' }, beast_design: { name: 'Bristleboar' } },
 *   { entity: { eid: 'b2' }, beast_design: { name: 'Bog slime' } },
 *   { entity: { eid: 'b3' }, beast_design: { name: 'Bog slime' } },
 * ]
 * let keys = [
 *   { entity: { eid: 'k1' }, key: { of: 'b1', value: 'beast:boar' } },
 *   { entity: { eid: 'k2' }, key: { of: 'b2', value: 'beast:bogslime' } },
 * ]
 * let named = (word: string) => creatureNamed(word, beasts, keys)
 * assertEquals(
 *   ['beast:boar', 'boar', 'Bristleboar', 'b1'].map(named),
 *   ['b1', 'b1', 'b1', 'b1'],
 * )
 * assertEquals([named('beast:bogslime'), named('wyrm')], ['b2', null])
 * assertThrows(() => named('bog slime'), Error, 'use its alias')
 * ```
 */
export let creatureNamed = (
  word: string,
  beasts: Bundle[],
  keys: Bundle[],
): string | null => {
  let eids = new Set(beasts.map((b) => b.entity.eid))
  let w = word.trim()
  if (eids.has(w)) return w
  let want = plain(w)
  if (!want) return null
  let aliased = keys.flatMap((k) => {
    let { of, value } = comp(k, 'key')
    return typeof of == 'string' && eids.has(of) && typeof value == 'string' &&
        [value, value.split(':').at(-1)!].some((v) => plain(v) == want)
      ? [of]
      : []
  })
  let titled = beasts
    .filter((b) => plain(String(comp(b, 'beast_design').name ?? '')) == want)
    .map((b) => b.entity.eid)
  let found = [...new Set([...aliased, ...titled])]
  if (found.length > 1) {
    throw new Error(`Several creatures are called ${w}; use its alias.`)
  }
  return found[0] ?? null
}

/**
 * A hero's level, from their slain and journal rows, as their page counts it
 * (play.ts): the level a creature they spawn fights at.
 *
 * ```ts
 * import { seedDesigns } from './designs_fixture.ts'
 * seedDesigns()
 * import { assert, assertEquals } from '@std/assert'
 * import { beastId } from './beasts.ts'
 * let slime = beastId('beast:slime')!
 * let kills = Array.from({ length: 10 }, (_, i) => ({
 *   entity: { eid: `s${i}` },
 *   slain: { creature: `c${i}`, by: 'p', beast: slime, at: i, xp: 14 },
 * }))
 * assertEquals(heroLevel([], []), 1)
 * assert(heroLevel(kills, []) > 1)
 * ```
 */
export let heroLevel = (slain: Bundle[], journal: Bundle[]): number =>
  levelOf(xpOf(killsOf(slain), QUESTS, entriesOf(journal)))

/** The row /spawn writes: creature `beast` standing at (x, z), fighting at
 * `lvl`, in the region and chunk that spot belongs to. */
export let spawnedAt = (
  beast: string,
  x: number,
  z: number,
  lvl: number,
  eid: string = crypto.randomUUID(),
): Bundle => ({
  entity: { eid },
  spawned: { beast, lvl, x, z, roam: ROAM },
  place: placeOf(x, z),
})

/**
 * The home a page grows a spawned creature from: it wanders from where it
 * was put, fights at its own level whatever land it stands in, and has no
 * respawn, so its first fall is its last. Nothing for a row whose creature is
 * not decided yet.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { fallOf } from './rules.ts'
 * let home = homeOf(spawnedAt('b1', 10, 20, 7, 'e1'))!
 * assertEquals([home.eid, home.beast, home.lvl, home.home], [
 *   'e1',
 *   'b1',
 *   7,
 *   [10, 20],
 * ])
 * let year = 365 * 24 * 3600e3
 * assertEquals(fallOf([{ at: 1 }], home.respawn ?? Infinity, year).down, true)
 * assertEquals(homeOf({ entity: { eid: 'e2' }, spawned: { x: 1, z: 1 } }), null)
 * ```
 */
export let homeOf = (row: Bundle): Home | null => {
  let { beast, lvl, x, z, roam } = comp(row, 'spawned')
  let { level } = comp(row, 'place')
  if (
    typeof beast != 'string' || typeof level != 'string' ||
    typeof x != 'number' || typeof z != 'number'
  ) return null
  let eid = row.entity.eid
  return {
    eid,
    beast,
    level,
    home: [x, z],
    roam: typeof roam == 'number' ? roam : ROAM,
    seed: hashOf(eid),
    lvl: typeof lvl == 'number' ? lvl : 1,
  }
}

/** The spawned creatures within `r` metres of (x, z), of `rows`. */
export let spawnedNear = (
  rows: Bundle[],
  x: number,
  z: number,
  r: number,
): Home[] =>
  rows.flatMap((row) => {
    let h = homeOf(row)
    return h && Math.hypot(h.home[0] - x, h.home[1] - z) < r ? [h] : []
  })
