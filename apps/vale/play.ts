// A frame of the game. The page's graph holds what is true: where each player
// and creature is and how it moves (`position`, `motion`), how each player
// fares (`vitals`, `fight`), whom each creature hunts (`hunt`), and the rows of
// what everyone has done. This reads it, decides what happens next, and hands
// back the frame's changes as one list for one `mutate`, with what happened,
// for the eyes and ears (`Event`).
//
// Who decides what:
//   - A player's own page moves them, swings their blade, takes the bites
//     aimed at them, and says how they fare. A page moves what it moves every
//     frame and says where it is ten times a second (`PACE`).
//   - One page moves each creature: of the players near its home, the one
//     whose eid sorts first. Its position and hunt are relayed from there, and
//     every other page draws what it hears. A creature nobody is near, or
//     that is only wandering, has no position: its wandering says where it
//     is (sim.ts `rest`), the same on every page.
//   - A creature's health is its most, less what the fights say was dealt it
//     in this life (rules.ts `hpOf`). A fall is a `slain` row, one per player
//     who helped, and the loot it leaves is each player's own.
import { BEASTS } from './beasts.ts'
import { homesOf } from './homes.ts'
import type { Intent } from './input.ts'
import { ITEMS } from './items.ts'
import { type Bundle, comp, type Net, num, str } from './net.ts'
import { GIVERS, type Quest, QUESTS } from './quests.ts'
import {
  blow,
  edgeOf,
  fallOf,
  type Fight,
  type Held,
  hpOf,
  hunter,
  levelOf,
  lootOf,
  maxHp,
  questsOf,
  type Slain,
  xpOf,
} from './rules.ts'
import { type Body, inVillage, prowl, rest, turn, walk } from './sim.ts'
import { groundAt, type Vale, vale } from './terrain.ts'

export type Vec3 = [number, number, number]

export type Event =
  | {
    type: 'hit'
    eid: string
    beast: string
    at: Vec3
    dmg: number
    great: boolean
  }
  | { type: 'struck'; eid: string; at: Vec3; dmg: number }
  | { type: 'whiff' }
  | { type: 'hurt'; dmg: number; at: Vec3 }
  | { type: 'fall'; eid: string; beast: string; at: Vec3 }
  | { type: 'loot'; item: string; n: number; at: Vec3 }
  | { type: 'xp'; n: number; at: Vec3 }
  | { type: 'level'; lvl: number }
  | { type: 'heal'; n: number; at: Vec3 }
  | { type: 'faint' }
  | { type: 'rise' }
  | { type: 'travel'; to: string }
  | { type: 'say'; text: string }

/** Where one player stands with the vale: what they have earned and carry. */
export type Sheet = {
  name: string
  xp: number
  lvl: number
  max: number
  edge: number
  bag: Held[]
  quests: ReturnType<typeof questsOf>
}

export type Vitals = { hp: number; max: number; lvl: number }

/** A creature as this frame sees it. */
export type Mob = {
  eid: string
  kind: string
  body: Body
  hp: number
  most: number
  down: boolean
  /** when it went down, in ms */
  since: number
  /** a blow landed on it this recently, in ms since */
  hurt: number
  /** it bit this recently, in ms since */
  bit: number
  near: number
}

/** Another player in this level, as this frame sees them. */
export type Other = {
  eid: string
  name: string
  look: { tint: string; hair: string; skin: string }
  body: Body
  vitals: Vitals
  swing: number
}

export type Drop = {
  eid: string
  kind: string
  n: number
  x: number
  y: number
  z: number
  at: number
}

/** Someone who gives quests, where they stand, and what they have for me:
 * a quest to offer (`!`), one to hand in (`?`), or nothing. */
export type Giver = {
  id: string
  name: string
  x: number
  z: number
  greets: string
  look: { tint: string; hair: string; skin: string }
  staff: boolean
  next: ReturnType<typeof questsOf>[number] | null
  mark: '' | '!' | '?'
  near: number
}

export type Frame = {
  /** the level the hero is in */
  level: string
  body: Body
  vitals: Vitals
  down: boolean
  sheet: Sheet
  mobs: Mob[]
  others: Other[]
  drops: Drop[]
  givers: Giver[]
  /** the giver close enough to talk to */
  talk: Giver | null
  /** the creature being fought, if one */
  foe: Mob | null
  /** how far through a blow, 0 to 1, or -1 */
  swing: number
  events: Event[]
  /** the store's time, in ms */
  now: number
}

let SPEED = 5.6
let SWING = 520
let HIT_AT = 170
let DOWN = 5000
let LEASH = 26
let PICK = 1.3
let PULL = 3.8
let DROP_LIFE = 120_000
let TALK = 3.6
// How near its home a player must be for a creature to be moved at all.
let ACTIVE = 45
// How near a portal's middle a walker must come to go through it.
let PORTAL = 1.1

let round = (v: number, k = 1000) => Math.round(v * k) / k
let dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

type Where = { level: string; x: number; y: number; z: number }
let where = (b: Bundle | undefined): Where | null => {
  let p = comp(b, 'position')
  return p.x == null
    ? null
    : { level: str(p.level), x: num(p.x), y: num(p.y), z: num(p.z) }
}
let motion = (b: Bundle | undefined) => {
  let m = comp(b, 'motion')
  return { yaw: num(m.yaw), gait: str(m.gait, 'idle'), vy: num(m.vy) }
}
let vitals = (b: Bundle | undefined): Vitals | null => {
  let t = comp(b, 'vitals')
  return t.hp == null
    ? null
    : { hp: num(t.hp), max: num(t.max, 1), lvl: num(t.lvl, 1) }
}
let fight = (b: Bundle | undefined): Fight & { swing: number } => {
  let f = comp(b, 'fight')
  return {
    foe: str(f.foe),
    life: num(f.life),
    dmg: num(f.dmg),
    swing: num(f.swing),
  }
}
let hunt = (b: Bundle | undefined) => {
  let h = comp(b, 'hunt')
  return { player: str(h.player), bite: num(h.bite) }
}
let bodyOf = (p: Where, m: ReturnType<typeof motion>): Body => ({
  x: p.x,
  y: p.y,
  z: p.z,
  vy: m.vy,
  yaw: m.yaw,
  speed: 0,
  gait: m.gait,
})

// A mover's components as they should be written: rounded, so a mover that
// has not moved writes nothing.
type Placed = ReturnType<typeof placed>
let placed = (level: string, b: Body) => ({
  position: { level, x: round(b.x), y: round(b.y), z: round(b.z) },
  motion: { yaw: round(b.yaw, 100), gait: b.gait, vy: round(b.vy, 100) },
})
let same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a).every((k) => a[k] === b[k])

// How often, in ms, a page says where a mover it moves is: it moves them
// every frame, and tells the others ten times a second.
//
// TODO: the relay's pace, declared once on the component in vocab.json and
// kept by the client, so a page writes every frame and its own graph holds
// every write while the peers hear the latest at most that often. Until the
// platform has one, a page keeps its movers in memory between sayings.
let PACE = 100

/** Where a hero stands on arriving in a level: in front of the portal that
 * leads back to where they came from, or by the village fire, or at the
 * level's arrival place. */
export let arrival = (v: Vale, from?: string): Body => {
  let back = v.portals.find((p) => p.to == from)
  let [x, z] = back ? [back.x, back.z + 2.6] : v.hearth
    ? [
      v.hearth[0] - 1.5 + Math.random() * 3,
      v.hearth[1] + 3.5 + Math.random() * 1.5,
    ]
    : v.places[v.level.arrive] ?? [64, 64]
  return {
    x,
    y: groundAt(v, x, z),
    z,
    vy: 0,
    yaw: Math.PI,
    speed: 0,
    gait: 'idle',
  }
}

/** The game over one store. Each frame is played in the level the hero is
 * in. */
export let game = (net: Net) => {
  let c = net.client
  let drops = c.watch('.drop', { remote: false })
  let swingAt = -1e9
  let struck = true
  let downAt = 0
  let hurtAt = 0
  let mend = 0
  let lvlWas = 0
  let shares = new Set<string>()
  let sinking = new Map<string, number>()
  let hpWas = new Map<string, number>()
  let hitAt = new Map<string, number>()
  let bitten = new Map<string, number>()
  let wasDown = new Set<string>()
  let last = new Map<string, Body>()
  let anchored = new Set<string>()

  // Each mover this page moves (its hero, the creatures it owns): where it is
  // in this page's memory, and what was last said of it and when. While the
  // graph still holds what was said, the memory is the mover; a place this
  // page did not say (someone else moved it) wins.
  let moved = new Map<
    string,
    { level: string; body: Body; said: Placed; at: number }
  >()
  let recall = (eid: string, e: Bundle | undefined) => {
    let m = moved.get(eid)
    return m && same(m.said.position, comp(e, 'position')) &&
        same(m.said.motion, comp(e, 'motion'))
      ? m
      : null
  }
  let say = (eid: string, level: string, body: Body, change: Bundle[]) => {
    let t = performance.now()
    let m = moved.get(eid)
    let p = placed(level, body)
    let quiet = m && (t - m.at < PACE ||
      same(p.position, m.said.position) && same(p.motion, m.said.motion))
    if (m && quiet) Object.assign(m, { level, body })
    else {
      moved.set(eid, { level, body, said: p, at: t })
      change.push({ entity: { eid }, ...p })
    }
  }
  // A creature back on its wandering: nothing to say about where it is.
  let hush = (eid: string, change: Bundle[]) => {
    moved.delete(eid)
    change.push({ entity: { eid }, position: null, motion: null, hunt: null })
  }

  // The sheet, worked out again only when one of its rows changed.
  let sheetKey: unknown[] = []
  let sheet: Sheet | null = null
  let sheetOf = (): Sheet => {
    let slain = net.mine('slain'), items = net.mine('item')
    let used = net.mine('used'), journal = net.mine('journal')
    let name = str(comp(c.ent(net.hero ?? ''), 'player').name, 'Wanderer')
    let key = [slain, items, used, journal, name]
    if (sheet && key.every((k, i) => k == sheetKey[i])) return sheet
    sheetKey = key
    let kills = slain.map((b): Slain => {
      let s = comp(b, 'slain')
      return {
        creature: str(s.creature),
        by: str(s.by),
        kind: str(s.kind),
        at: num(s.at),
        xp: num(s.xp),
      }
    })
    let spent = new Set(used.map((b) => str(comp(b, 'used').item)))
    let bag = items.filter((b) => !spent.has(b.entity.eid)).map((b): Held => {
      let i = comp(b, 'item')
      return { eid: b.entity.eid, kind: str(i.kind), n: num(i.n, 1) }
    })
    let entries = journal.map((b) => {
      let j = comp(b, 'journal')
      return { quest: str(j.quest), step: str(j.step), at: num(j.at) }
    })
    let xp = xpOf(kills, QUESTS, entries)
    let lvl = levelOf(xp)
    sheet = {
      name,
      xp,
      lvl,
      max: maxHp(lvl),
      edge: edgeOf(bag),
      bag,
      quests: questsOf(QUESTS, entries, kills, bag),
    }
    return sheet
  }

  // Each creature's falls, from everyone's rows and mine still waiting.
  let fallsBy = () => {
    let by = new Map<string, { at: number }[]>()
    for (let b of net.falls()) {
      let s = comp(b, 'slain'), eid = str(s.creature)
      if (!by.has(eid)) by.set(eid, [])
      by.get(eid)!.push({ at: num(s.at) })
    }
    return by
  }

  let keepItem = (me: string, kind: string, n: number, now: number) =>
    net.keep({
      entity: { eid: crypto.randomUUID() },
      item: { kind, n, owner: me, at: now },
    })

  let spend = (me: string, eid: string, now: number) =>
    net.keep({
      entity: { eid: crypto.randomUUID() },
      used: { item: eid, by: me, at: now },
    })

  // The store's row for each creature this level grows, added the first time
  // a page meets it: what its position and falls attach to.
  let anchor = (v: Vale) => {
    let creatures = net.watches.creatures
    if (!creatures.ready) return
    let held = new Set(creatures.value.map((b) => b.entity.eid))
    let missing = homesOf(v).filter((h) =>
      !held.has(h.eid) && !anchored.has(h.eid)
    )
    for (let h of missing) anchored.add(h.eid)
    if (missing.length) {
      net.keep(
        ...missing.map((h) => ({
          entity: { eid: h.eid },
          creature: { kind: h.kind },
        })),
      )
    }
  }

  return {
    /** take up a quest */
    accept: (q: Quest) => {
      let me = net.hero
      if (!me) return
      net.keep({
        entity: { eid: crypto.randomUUID() },
        journal: { player: me, quest: q.id, step: 'taken', at: net.now() },
      })
    },
    /** hand a finished quest in: what it asked for goes, the gift comes */
    handIn: (q: Quest): Event[] => {
      let me = net.hero, s = sheet
      if (!me || !s) return []
      let now = net.now()
      if (q.goal == 'gather') {
        let left = q.count
        for (let h of s.bag) {
          if (h.kind != q.target || left <= 0) continue
          spend(me, h.eid, now)
          left -= h.n
        }
      }
      net.keep({
        entity: { eid: crypto.randomUUID() },
        journal: { player: me, quest: q.id, step: 'done', at: now },
      })
      if (q.gift) keepItem(me, q.gift, 1, now)
      let giver = GIVERS.find((g) => g.id == q.giver)?.name ?? 'They'
      let gift = q.gift
        ? ` ${giver} gives you ${ITEMS[q.gift]?.name ?? q.gift}.`
        : ''
      return [{ type: 'say', text: `${q.title}: done! +${q.xp} xp.${gift}` }]
    },

    frame: (
      v: Vale,
      intent: Intent,
      look: number,
      dt: number,
    ): Frame | null => {
      let me = net.hero
      if (!me) return null
      let lv = v.level.id
      let now = net.now()
      let events: Event[] = []
      let change: Bundle[] = []
      let s = sheetOf()
      let row = c.ent(me)
      let at = (b: { x: number; y: number; z: number }, up = 1): Vec3 => [
        b.x,
        b.y + up,
        b.z,
      ]
      anchor(v)

      // Me, as this page has me, or as the graph does when someone else moved
      // me: a hero with no place here (just come, back after a reload)
      // stands at the level's arrival.
      let pos = where(row)
      let held = recall(me, row) ??
        (pos && { level: pos.level, body: bodyOf(pos, motion(row)) })
      let here = held?.level == lv ? held.body : null
      let body = here ? { ...here } : arrival(v)
      let down = here?.gait == 'down'
      if (down) body.gait = 'idle'
      let vit = vitals(row)
      let hp = vit?.hp ?? s.max
      let mine = fight(row)
      let fought = { ...mine }
      if (lvlWas && s.lvl > lvlWas) {
        events.push({ type: 'level', lvl: s.lvl })
        hp = s.max
      }
      lvlWas = s.lvl

      // The hero: up again at the fire after fainting, or moving as asked.
      if (down) {
        if (now - downAt > DOWN) {
          body = arrival(v)
          hp = s.max
          down = false
          events.push({ type: 'rise' })
        }
      } else {
        let [mx, my] = intent.move
        let push = {
          x: Math.cos(look) * mx - Math.sin(look) * my,
          z: -Math.sin(look) * mx - Math.cos(look) * my,
          jump: intent.jump,
        }
        body = walk(v, body, push, dt, SPEED)
      }

      // The others in this level, as relayed.
      let others: Other[] = []
      let fights: [string, Fight][] = [[me, fought]]
      let spots = new Map<string, { x: number; z: number; alive: boolean }>()
      spots.set(me, { x: body.x, z: body.z, alive: !down })
      for (let b of net.watches.players.value) {
        let eid = b.entity.eid
        if (eid == me) continue
        let e = c.ent(eid)
        let p = where(e)
        if (!p || p.level != lv) continue
        let m = motion(e)
        let pl = comp(e, 'player')
        let f = fight(e)
        let t = vitals(e) ?? { hp: 1, max: 1, lvl: 1 }
        others.push({
          eid,
          name: str(pl.name, 'Wanderer'),
          look: {
            tint: str(pl.tint, '#c95f4a'),
            hair: str(pl.hair, '#5a3a26'),
            skin: str(pl.skin, '#e7b996'),
          },
          body: bodyOf(p, m),
          vitals: t,
          swing: f.swing,
        })
        fights.push([eid, f])
        spots.set(eid, { x: p.x, z: p.z, alive: m.gait != 'down' })
      }
      let falls = fallsBy()

      // The creatures.
      let mobs: Mob[] = []
      for (let h of homesOf(v)) {
        let beast = BEASTS[h.kind]
        if (!beast) continue
        let eid = h.eid
        let e = c.ent(eid)
        let home = { x: h.home[0], z: h.home[1] }
        let f = fallOf(falls.get(eid) ?? [], beast.respawn, now)
        let life = f.fell
        let hpNow = f.down
          ? 0
          : hpOf(eid, beast.hp, life, fights.map(([, f]) => f))
        let wasHp = hpWas.get(eid) ?? beast.hp
        hpWas.set(eid, hpNow)
        let fallen = f.down || hpNow <= 0
        if (fallen && !sinking.has(eid)) sinking.set(eid, f.down ? f.fell : now)
        if (!fallen) sinking.delete(eid)
        let up = wasDown.has(eid) && !fallen
        if (fallen) wasDown.add(eid)
        else wasDown.delete(eid)
        let p = where(e)
        let hu = hunt(e)
        let held = recall(eid, e)?.body ?? (p && bodyOf(p, motion(e)))
        let moving = p?.level == lv && !up
        // Where it is: where I have it, or where it is said to be, or where
        // it lay down, or where its wandering has it.
        let mb = held && moving
          ? { ...held }
          : fallen && last.has(eid)
          ? last.get(eid)!
          : rest(v, h.home, h.roam, h.seed, now)
        // Who moves it: of the players near its home, the first by eid.
        let owner = ''
        for (let [who, sp] of spots) {
          if (dist(sp, home) > ACTIVE) continue
          if (!owner || who < owner) owner = who
        }
        if (!fallen && hpNow < wasHp) {
          if (mine.foe != eid) {
            events.push({
              type: 'struck',
              eid,
              at: at(mb, beast.size + 0.3),
              dmg: wasHp - hpNow,
            })
          }
          hitAt.set(eid, now)
        }
        if (owner == me && !fallen) {
          // Whom it is after: whoever is hurting it most, while they stay
          // near its home; else, if it is the kind that minds, whoever comes
          // close.
          let quarry = ''
          let hn = hunter(eid, life, fights)
          let hs = hn ? spots.get(hn) : undefined
          if (hn && hs?.alive && dist(hs, home) < h.roam + LEASH) quarry = hn
          else if (beast.aggro) {
            let best = beast.aggro * (hu.player ? 1.8 : 1)
            for (let [w, sp] of spots) {
              if (!sp.alive || inVillage(v, sp.x, sp.z)) continue
              if (dist(sp, home) > h.roam + LEASH) continue
              let d = dist(sp, mb)
              if (d < best) [best, quarry] = [d, w]
            }
          }
          let qs = quarry ? spots.get(quarry) ?? null : null
          // Struck: knocked back from whoever is nearest.
          let knocked = false
          if (hpNow < wasHp) {
            let from: { x: number; z: number } | null = null
            for (let sp of spots.values()) {
              if (
                dist(sp, mb) < 3 && (!from || dist(sp, mb) < dist(from, mb))
              ) from = sp
            }
            if (from) {
              let k = 0.45 / Math.max(0.3, beast.size)
              let a = Math.atan2(mb.x - from.x, mb.z - from.z)
              mb = {
                ...mb,
                x: mb.x + Math.sin(a) * k,
                z: mb.z + Math.cos(a) * k,
              }
              knocked = true
            }
          }
          if (quarry || moving || knocked) {
            let next = prowl(v, mb, beast, h.home, h.roam, h.seed, now, dt, qs)
            let back = rest(v, h.home, h.roam, h.seed, now)
            if (!quarry && !knocked && dist(next, back) < 0.3) {
              if (p || hu.player) hush(eid, change)
              mb = back
            } else {
              mb = next
              say(eid, lv, mb, change)
            }
          }
          let bite = hu.bite
          if (
            qs && dist(qs, mb) <= beast.reach + 0.4 && now - hu.bite > 1500
          ) bite = now
          if (quarry != hu.player || bite != hu.bite) {
            change.push({
              entity: { eid },
              hunt: quarry ? { player: quarry, bite } : null,
            })
          }
        }
        // Up again after a fall: back to its wandering, from home.
        if (owner == me && up && (p || hu.player)) hush(eid, change)
        // A bite: the one aimed at me is mine to take.
        let seen = bitten.get(eid)
        if (seen === undefined) bitten.set(eid, hu.bite)
        else if (hu.bite > seen) {
          bitten.set(eid, hu.bite)
          if (hu.player == me && !down && !fallen) {
            let dmg = Math.round(beast.dmg * (0.85 + Math.random() * 0.3))
            hp -= dmg
            hurtAt = now
            events.push({ type: 'hurt', dmg, at: at(body, 2) })
          }
        }
        last.set(eid, mb)
        mobs.push({
          eid,
          kind: h.kind,
          body: mb,
          hp: hpNow,
          most: beast.hp,
          down: fallen,
          since: sinking.get(eid) ?? 0,
          hurt: now - (hitAt.get(eid) ?? -1e9),
          bit: now - (hu.bite || -1e9),
          near: dist(mb, body),
        })
      }

      // A fall I had a hand in: my row saying so, and my share of the loot.
      let fell = (m: Mob, life: number, when: number) => {
        let key = `${m.eid}:${life}`
        if (shares.has(key)) return
        shares.add(key)
        let beast = BEASTS[m.kind]
        net.keep({
          entity: { eid: crypto.randomUUID() },
          slain: {
            creature: m.eid,
            by: me,
            kind: m.kind,
            at: when,
            xp: beast.xp,
          },
        })
        events.push({
          type: 'fall',
          eid: m.eid,
          beast: m.kind,
          at: at(m.body, 0.5),
        })
        events.push({ type: 'xp', n: beast.xp, at: at(m.body, beast.size + 1) })
        lootOf(m.kind, m.eid, when, me).forEach((l, i) => {
          let a = (i / 3) * Math.PI * 2 + Math.random()
          let x = m.body.x + Math.cos(a) * 0.9, z = m.body.z + Math.sin(a) * 0.9
          change.push({
            entity: { eid: crypto.randomUUID() },
            drop: { kind: l.kind, n: l.n, at: now },
            position: { level: lv, x, y: groundAt(v, x, z), z },
          })
        })
      }

      // My blade.
      if (!down && intent.strike && now - swingAt > SWING) {
        swingAt = now
        struck = false
        fought.swing++
        // Turn to face the nearest creature in front, forgivingly.
        let best: Mob | null = null
        for (let m of mobs) {
          if (m.down || m.near > 2.4 + BEASTS[m.kind].size) continue
          let a = Math.atan2(m.body.x - body.x, m.body.z - body.z)
          if (
            Math.abs(
              Math.atan2(Math.sin(a - body.yaw), Math.cos(a - body.yaw)),
            ) > 1.9
          ) continue
          if (!best || m.near < best.near) best = m
        }
        if (best) {
          body.yaw = turn(
            body.yaw,
            Math.atan2(best.body.x - body.x, best.body.z - body.z),
            1.9,
          )
        }
      }
      if (!struck && now - swingAt >= HIT_AT) {
        struck = true
        let best: Mob | null = null
        for (let m of mobs) {
          if (m.down || m.near > 1.7 + BEASTS[m.kind].size * 0.5) continue
          let a = Math.atan2(m.body.x - body.x, m.body.z - body.z)
          let off = Math.abs(
            Math.atan2(Math.sin(a - body.yaw), Math.cos(a - body.yaw)),
          )
          if (off > 1.2 && m.near > 1) continue
          if (!best || m.near < best.near) best = m
        }
        if (!best) events.push({ type: 'whiff' })
        else {
          let m = best, beast = BEASTS[m.kind]
          let life = fallOf(falls.get(m.eid) ?? [], beast.respawn, now).fell
          if (fought.foe != m.eid || fought.life != life) {
            Object.assign(fought, { foe: m.eid, life, dmg: 0 })
          }
          let { dmg, great } = blow(s.lvl, s.edge, Math.random())
          fought.dmg += dmg
          m.hp = hpOf(m.eid, beast.hp, life, fights.map(([, f]) => f))
          hitAt.set(m.eid, now)
          m.hurt = 0
          events.push({
            type: 'hit',
            eid: m.eid,
            beast: m.kind,
            at: at(m.body, beast.size + 0.4),
            dmg,
            great,
          })
          if (m.hp <= 0) {
            m.down = true
            m.since = now
            sinking.set(m.eid, now)
            fell(m, life, now)
          }
        }
      }

      // Someone else's blow felled what I was fighting: my share.
      if (fought.foe && fought.dmg > 0) {
        let m = mobs.find((m) => m.eid == fought.foe)
        if (m) {
          let f = fallOf(falls.get(m.eid) ?? [], BEASTS[m.kind].respawn, now)
          if (f.down && f.fell > fought.life) fell(m, fought.life, f.fell)
          else if (m.down && f.fell == fought.life) fell(m, fought.life, now)
        }
      }

      // A tonic.
      if (intent.drink && !down) {
        let tonic = s.bag.find((h) => ITEMS[h.kind]?.heals)
        if (!tonic) {
          events.push({
            type: 'say',
            text: 'No tonic left. The Elder brews them.',
          })
        } else if (hp >= s.max) {
          events.push({ type: 'say', text: 'You feel fine already.' })
        } else {
          spend(me, tonic.eid, now)
          let n = Math.min(s.max - hp, ITEMS[tonic.kind]?.heals ?? 60)
          hp += n
          events.push({ type: 'heal', n, at: at(body, 2) })
        }
      }

      // Mending, a point at a time, when nothing has bitten for a while.
      if (!down && now - hurtAt > 6000 && hp < s.max) {
        mend += s.max * 0.025 * dt
        let n = Math.floor(mend)
        mend -= n
        hp = Math.min(s.max, hp + n)
      } else mend = 0
      if (!down && hp <= 0) {
        hp = 0
        down = true
        downAt = now
        events.push({ type: 'faint' })
      }

      // Loot on the ground: drawn to me when near, mine when touched.
      let lying: Drop[] = []
      for (let b of drops.value) {
        let e = c.ent(b.entity.eid)
        let d = comp(e, 'drop'), p = where(e)
        if (d.kind == null || !p || p.level != lv) continue
        let drop: Drop = {
          eid: b.entity.eid,
          kind: str(d.kind),
          n: num(d.n, 1),
          x: p.x,
          y: p.y,
          z: p.z,
          at: num(d.at),
        }
        let dd = dist(drop, body)
        let gone = { entity: { eid: drop.eid }, drop: null, position: null }
        if (now - drop.at > DROP_LIFE) change.push(gone)
        else if (!down && dd < PICK && now - drop.at > 350) {
          change.push(gone)
          keepItem(me, drop.kind, drop.n, now)
          events.push({
            type: 'loot',
            item: drop.kind,
            n: drop.n,
            at: at(drop, 0.6),
          })
        } else {
          if (!down && dd < PULL && now - drop.at > 350) {
            let k = Math.min(1, (dt * 7) / dd)
            drop.x += (body.x - drop.x) * k
            drop.z += (body.z - drop.z) * k
            drop.y = Math.max(groundAt(v, drop.x, drop.z), drop.y)
            change.push({
              entity: { eid: drop.eid },
              position: { level: lv, x: drop.x, y: drop.y, z: drop.z },
            })
          }
          lying.push(drop)
        }
      }

      // The people of this level who give quests.
      let givers: Giver[] = GIVERS.filter((g) => g.level == lv).map((g) => {
        let [px, pz] = v.places[g.place] ?? [64, 64]
        let x = px + g.offset[0], z = pz + g.offset[1]
        let theirs = s.quests.filter((q) => q.quest.giver == g.id)
        let next = theirs.find((q) => q.state == 'taken') ??
          theirs.find((q) => q.state == 'open') ?? null
        let mark: '' | '!' | '?' = !next
          ? ''
          : next.state == 'open'
          ? '!'
          : next.have >= next.quest.count
          ? '?'
          : ''
        return {
          id: g.id,
          name: g.name,
          x,
          z,
          greets: g.greets,
          look: g.look,
          staff: !!g.staff,
          next,
          mark,
          near: Math.hypot(x - body.x, z - body.z),
        }
      })
      let talk = down ? null : givers
        .filter((g) => g.near < TALK)
        .sort((a, b) => a.near - b.near)[0] ?? null

      // Through a portal: on to the level beyond, in front of the portal back.
      let level = lv
      let portal = v.portals.find((p) => dist(p, body) < PORTAL)
      if (portal && !down) {
        level = portal.to
        body = arrival(vale(portal.to), lv)
        events.push({ type: 'travel', to: portal.to })
      }

      // What I am, for the others.
      say(me, level, { ...body, gait: down ? 'down' : body.gait }, change)
      let vitalsNow = {
        hp: Math.max(0, Math.round(hp)),
        max: s.max,
        lvl: s.lvl,
      }
      if (!same(vitalsNow, comp(row, 'vitals'))) {
        change.push({ entity: { eid: me }, vitals: vitalsNow })
      }
      if (!same(fought, mine)) {
        change.push({ entity: { eid: me }, fight: fought })
      }
      net.move(change)
      net.tick()

      let foe =
        mobs.find((m) =>
          m.eid == fought.foe && !m.down && now - (hitAt.get(m.eid) ?? 0) < 8000
        ) ?? null
      return {
        level,
        body,
        vitals: vitalsNow,
        down,
        sheet: s,
        mobs,
        others,
        drops: lying,
        givers,
        talk,
        foe,
        swing: now - swingAt < SWING ? (now - swingAt) / SWING : -1,
        events,
        now,
      }
    },
  }
}
