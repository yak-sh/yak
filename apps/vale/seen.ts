// Where a hero was last seen (`seen` in vocab.json): the region, the spot in
// the world and which way they faced. The next load brings them back there,
// and the villagers of that region stay awake while somebody plays in it
// (villagers.ts `born`).
//
// The store keeps it on the hero's row, for a hero its person made, so they
// come back to it on any device. A guest owns no row to write it on (a writer
// signed out only adds rows), so their tab keeps it (sessionStorage), as the
// tab keeps which hero it plays (net.ts). The tab keeps it for every hero, and
// the newer of the two counts, so a reload comes back to the very spot. It is
// written rarely: on coming into a region, every half minute while the hero
// moves about, every two minutes while they stand (which keeps the villagers
// awake), and as the page is hidden. Where a hero is this moment, ten times a
// second, is `position`, which nobody keeps.
import { writer } from './chat.ts'
import { LEVELS, SIZE } from './levels.ts'
import type { Bundle, Me, Net } from './net.ts'
import type { Frame } from './play.ts'

type Sighting = Pick<Frame, 'level' | 'down' | 'teleported' | 'teleportAck'> & {
  body: Pick<Frame['body'], 'x' | 'z' | 'yaw'>
}

/** Where a hero was last seen: the region, where in the world in metres,
 * which way they faced in radians, and when, in ms. */
export type Seen = {
  level: string
  x: number
  z: number
  yaw: number
  at: number
  teleport?: string
}

// How often a hero who moves about is written, and one who stands, in ms;
// the second well inside the five minutes that keep the villagers awake.
let EVERY = 30_000
let STILL = 2 * 60_000
// How far a hero must have gone, in metres, to have moved.
let MOVED = 1

/** Whether where a hero is now is worth writing, after what was last
 * written: on coming into a region, once they have moved about a while, and
 * now and then while they stand.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let seen = (level: string, x: number, at: number) =>
 *   ({ level, x, z: 0, yaw: 0, at })
 * let was = seen('mossvale', 0, 0)
 * assertEquals(due(null, was), true) // arriving
 * assertEquals(due(was, seen('birchmere', 0, 1000)), true) // on by a road
 * assertEquals(due(was, seen('mossvale', 9, 1000)), false) // a second's run
 * assertEquals(due(was, seen('mossvale', 9, 60_000)), true) // a minute's walk
 * assertEquals(due(was, seen('mossvale', 0, 60_000)), false) // a minute still
 * assertEquals(due(was, seen('mossvale', 0, 600_000)), true) // ten minutes
 * ```
 */
export let due = (was: Seen | null, is: Seen): boolean => {
  if (!was || was.level != is.level) return true
  let since = is.at - was.at
  return since >= STILL ||
    since >= EVERY && Math.hypot(is.x - was.x, is.z - was.z) >= MOVED
}

/** Where a row says its hero was last seen: a level the vale has and a spot
 * in it, or null.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let row = (seen: Record<string, string | number>) =>
 *   ({ entity: { eid: 'h' }, seen })
 * let at = '1970-01-01T00:00:02.000Z'
 * assertEquals(
 *   seenOf(row({ level: 'birchmere', x: 3, z: 4, yaw: 1, at })),
 *   { level: 'birchmere', x: 3, z: 4, yaw: 1, at: 2000 },
 * )
 * assertEquals(seenOf(row({ level: 'birchmere', at })), null) // no spot
 * assertEquals(seenOf(row({ level: 'atlantis', x: 3, z: 4, at })), null)
 * assertEquals(seenOf(undefined), null)
 * ```
 */
export let seenOf = (b: Bundle | undefined): Seen | null => {
  let s = b?.seen
  if (!s || typeof s != 'object') return null
  let { level, x, z, yaw, at, teleport } = s as Record<string, unknown>
  let t = Date.parse(String(at))
  return typeof level == 'string' && Object.hasOwn(LEVELS, level) &&
      typeof x == 'number' && typeof z == 'number' && t
    ? {
      level,
      x,
      z,
      yaw: typeof yaw == 'number' ? yaw : 0,
      at: t,
      ...(typeof teleport == 'string' ? { teleport } : {}),
    }
    : null
}

// The row saying `hero` was seen `s`, as the store and the tab keep it.
let rowOf = (hero: string, s: Seen): Bundle => ({
  entity: { eid: hero },
  seen: {
    level: s.level,
    x: s.x,
    z: s.z,
    yaw: s.yaw,
    at: new Date(s.at).toISOString(),
    ...(s.teleport ? { teleport: s.teleport } : {}),
  },
})

// The tab's copy: the last row it wrote, for whichever hero it plays.
let KEY = 'mossvale.seen.256'
let OLD_KEY = 'mossvale.seen'
let moved = (b: Bundle): Bundle | undefined => {
  let s = seenOf(b)
  if (!s) return
  let [i, k] = LEVELS[s.level].cell, step = SIZE - 128
  return rowOf(b.entity.eid, {
    ...s,
    x: s.x + i * step + step / 2,
    z: s.z + k * step + step / 2,
  })
}
let tab = {
  get: (): Bundle | undefined => {
    try {
      let row = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
      if (row) return row
      let old = JSON.parse(sessionStorage.getItem(OLD_KEY) ?? 'null')
      let next = old && moved(old)
      if (next) {
        sessionStorage.setItem(KEY, JSON.stringify(next))
        sessionStorage.removeItem(OLD_KEY)
      }
      return next ?? undefined
    } catch {
      return undefined
    }
  },
  set: (b: Bundle) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(b))
    } catch { /* a tab that cannot keep it comes back where the store says */ }
  },
}

/** Where `hero` was last seen: the newer of what this tab and the store
 * (`stored`) say. */
export let recall = (hero: string, stored: Seen | null): Seen | null => {
  let t = tab.get()
  let kept = t?.entity?.eid == hero ? seenOf(t) : null
  return !kept || stored && stored.at > kept.at ? stored : kept
}

let cm = (v: number) => Math.round(v * 100) / 100
let same = (a: Seen, b: Seen) =>
  a.level == b.level && a.x == b.x && a.z == b.z && a.yaw == b.yaw &&
  a.teleport == b.teleport

/** Where the hero this tab plays is seen, written as they play: `me` says
 * who is looking, and `tick` takes each frame played in the level on show. */
export let sighting = (net: Net) => {
  let me: Me | null = null
  // Who made each hero, which says whose hero is theirs to write on.
  // net.choose watches that hero's row, including its created stamp.
  // What was last written for which hero, and where the last frame had them.
  let wrote: { hero: string; seen: Seen } | null = null
  let last: Seen | null = null
  let write = (hero: string, s: Seen) => {
    let row = rowOf(hero, s)
    tab.set(row)
    // Only a hero its person made is theirs to write on: a refused row would
    // take the rows it went with down with it. A hero just made is theirs
    // once the store says who made it, and until then it is written again.
    let by = writer(net.client.ent(hero))
    if (by && by == me?.person && me.writes) net.keep(row)
    if (by || !me?.person) wrote = { hero, seen: s }
  }
  // The page is hidden, or going: where the hero is, if that is not written.
  let hide = () => {
    let hero = net.hero
    if (!hero || !last || wrote?.hero == hero && same(wrote.seen, last)) return
    write(hero, last)
    net.flush()
  }
  addEventListener('visibilitychange', () => {
    if (document.visibilityState == 'hidden') hide()
  })
  addEventListener('pagehide', hide)
  return {
    me: (who: Me) => {
      me = who
    },
    tick: (f: Sighting) => {
      let hero = net.hero
      if (!hero || f.down && !f.teleported) return
      let b = f.body
      let ack = f.teleported ||
        f.teleportAck ||
        (wrote?.hero == hero ? wrote.seen.teleport : undefined) ||
        seenOf(net.client.ent(hero))?.teleport
      last = {
        level: f.level,
        x: cm(b.x),
        z: cm(b.z),
        yaw: cm(b.yaw),
        at: net.now(),
        ...(ack ? { teleport: ack } : {}),
      }
      if (f.teleported || due(wrote?.hero == hero ? wrote.seen : null, last)) {
        write(hero, last)
        if (f.teleported) net.flush()
      }
    },
  }
}
