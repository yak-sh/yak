// A frame of the game. The page's graph holds what is true: where each player
// and creature is and how it moves (`position`, `motion`), how each player
// fares (`vitals`, `fight`), whom each creature hunts (`hunt`), and the rows of
// what everyone has done. This reads it, decides what happens next, and hands
// back the frame's changes as one list for one `mutate`, with what happened,
// for the eyes and ears (`Event`).
//
// Who decides what:
//   - A player's own page moves them, swings their weapon or looses its
//     shots, does their abilities (abilities.ts), rolls them clear, takes
//     the bites aimed at them through their armour, and says how they fare
//     and what they wear (`gear`). A page moves what it moves every frame
//     and writes where it is whenever that changed; the peers hear it ten
//     times a second at most (`pace` in vocab.json). It says when, to the
//     second (`BEAT`), so a page that plays says so once a second even
//     standing still, and the others can tell it from one that sleeps.
//   - A bite is said before it lands (`hunt.bite` is when), and the creature
//     winds up for it meanwhile. The bitten player's page decides it when it
//     lands: rolled through, blocked, stepped clear, or taken.
//   - One page moves each creature: of the players near its home whose pages
//     play, the one whose eid sorts first. When that page goes quiet (its tab
//     hidden, or frozen), the next one takes the creature from where it was
//     last said to be. Its position and hunt are relayed from there, and
//     every other page draws what it hears. A creature nobody is near, or
//     that is only wandering, has no position: its wandering says where it
//     is (sim.ts `rest`), the same on every page.
//   - A creature's health is its most, less what the fights say was dealt it
//     in this life (rules.ts `hpOf`), and one that a fight says is held
//     neither moves nor bites (`heldOf`). A fall is a `slain` row, one per
//     player who helped, and the loot it leaves is each player's own.
import { abilitiesOf, again, BLEEDS, WARD, type Went } from './abilities.ts'
import { type Slot, SLOTS } from './arms.ts'
import { BEASTS } from './beasts.ts'
import { foeOf } from './danger.ts'
import { heed } from './gaze.ts'
import {
  canWear,
  firsts,
  type Hand,
  handOf,
  type Kit,
  kitOf,
  rack,
  twins,
  type Worn,
  wornOf,
} from './gear.ts'
import { homesNear } from './homes.ts'
import { publish, pulses, replay } from './combat.ts'
import type { Intent } from './input.ts'
import { ITEMS } from './items.ts'
import { HOME, type Spot } from './levels.ts'
import { type Bundle, comp, type Net, num, str } from './net.ts'
import { GIVERS, type Quest, QUESTS, questXp } from './quests.ts'
import {
  biteOf,
  blow,
  blowOf,
  type Dealing,
  type Dealt,
  fallOf,
  type Held,
  heldOf,
  hpOf,
  hunter,
  levelOf,
  lootOf,
  maxHp,
  questsOf,
  type Slain,
  type Standing,
  unpinnedOf,
  worth,
  xpOf,
} from './rules.ts'
import { itemLevel, type Rarity, rarityOf } from './rarity.ts'
import { destination } from './fires.ts'
import type { Seen } from './seen.ts'
import {
  type Body,
  inVillage,
  prowl,
  rest,
  sheltered,
  turn,
  walk,
} from './sim.ts'
import { canLearn, formOf, learnedOf, pointsOf, skilled } from './skills.ts'
import { aimFor, aimOf, aims, FLIGHT, LAND, landOf, takenBy } from './strike.ts'
import { stepPush, stride } from './stride.ts'
import { regionOf, spotOf } from './regions.ts'
import { destinationOf, nextTeleport, resumed } from './teleport.ts'
import { placeOf } from './area.ts'
import { upgradesOf } from './upgrade.ts'
import { groundAt, hearthNear, hearthOf, type Vale } from './terrain.ts'
import { arriveOf } from './ways.ts'

export type Vec3 = [number, number, number]

export type Event =
  | {
    type: 'hit'
    eid: string
    beast: string
    at: Vec3
    dmg: number
    great: boolean
    by?: string
  }
  | { type: 'struck'; eid: string; at: Vec3; dmg: number }
  | { type: 'whiff'; family: string }
  | { type: 'roll'; at: Vec3 }
  | { type: 'dodge'; at: Vec3 }
  | { type: 'hurt'; dmg: number; at: Vec3 }
  | { type: 'fall'; eid: string; beast: string; at: Vec3 }
  /** a thing picked up: its kind, how many, and a piece's row and rarity */
  | {
    type: 'loot'
    item: string
    n: number
    at: Vec3
    piece: string
    rarity?: Rarity
  }
  /** a piece finer than common falls to the ground, at `at` */
  | { type: 'spoil'; rarity: Rarity; at: Vec3 }
  | { type: 'xp'; n: number; at: Vec3 }
  | { type: 'level'; lvl: number }
  | { type: 'heal'; n: number; at: Vec3 }
  | { type: 'faint' }
  | { type: 'rise' }
  | { type: 'travel'; to: string }
  | { type: 'say'; text: string }
  /** a thing put on for a slot never chosen for: its kind, row and rarity */
  | { type: 'wear'; item: string; piece: string; rarity?: Rarity }
  /** someone did an ability: `at` their feet, facing `yaw` */
  | {
    type: 'ability'
    id: string
    by: string
    at: Vec3
    from?: Vec3
    yaw: number
  }
  /** an ability of mine lands over `r` metres about `at`, in `ms` */
  | { type: 'burst'; id: string; at: Vec3; r: number; ms: number }
  | { type: 'held'; at: Vec3 }
  | { type: 'block'; at: Vec3 }
  | { type: 'ward'; n: number; at: Vec3 }
  | {
    type: 'shot'
    kind: 'arrow' | 'bolt'
    flame?: boolean
    from: Vec3
    to: Vec3
    /** how long it flies, in ms */
    ms: number
  }

/** Where one player stands with the vale: what they have earned, carry and
 * wear, the skills they chose, and how they fight with all of it. */
export type Sheet = {
  name: string
  xp: number
  lvl: number
  /** the most health they can have: their level's, and their gear's */
  max: number
  bag: Held[]
  worn: Worn
  kit: Kit
  /** what to put on in the slots they never chose for (gear.ts `firsts`) */
  firsts: { slot: Slot; item: string }[]
  /** the abilities on the bar's three slots, by id, or empty */
  abilities: string[]
  /** the skills they know, in the order learned (skills.ts), and the points
   * they have still to spend */
  learned: string[]
  points: number
  quests: Standing[]
  /** the quests and deals they unpinned, by id (journal.ts) */
  unpinned: Set<string>
}

export type Vitals = { hp: number; max: number; lvl: number }

/** A creature as this frame sees it. */
export type Mob = {
  eid: string
  kind: string
  land: string
  lvl: number
  home: [number, number]
  body: Body
  hp: number
  most: number
  down: boolean
  /** when it went down, in ms */
  since: number
  /** a blow landed on it this recently, in ms since */
  hurt: number
  /** how far through a bite, 0 to 1, landing at 0.4, or -1 */
  bite: number
  /** its bite is aimed at me */
  aim: boolean
  /** how near, middle to middle, its bite takes whoever is there */
  reach: number
  near: number
  /** held still by someone's blow: it neither moves nor bites */
  held: boolean
}

/** Another player within sight, as this frame sees them. */
export type Other = {
  eid: string
  name: string
  look: { tint: string; hair: string; skin: string }
  body: Body & { vx: number; vz: number; at: number }
  vitals: Vitals
  /** what they wear, the kind in each slot, as they say */
  gear: Record<string, string>
  /** the creature they are fighting */
  foe: string
  swing: number
  /** how far through a dodge, 0 to 1, or -1 */
  roll: number
}

export type Drop = {
  eid: string
  kind: string
  n: number
  /** a piece of gear's rarity, to show it lying there */
  rarity?: Rarity
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
  y: number
  z: number
  greets: string
  look: { tint: string; hair: string; skin: string }
  build?: 'child'
  staff: boolean
  next: Standing | null
  mark: '' | '!' | '?'
  near: number
  /** the way they walk, or null while they stand */
  walk: number | null
  /** the hero they look at, the nearest from any page, and whether near
   * enough to talk (gaze.ts) */
  heed: { x: number; z: number; talk: boolean } | null
}

export type Frame = {
  /** the level whose region the hero is in */
  level: string
  body: Body
  vitals: Vitals
  down: boolean
  /** an admin request placed this hero during this frame */
  teleported: string | null
  /** the most recent request already answered on this tab or in the store */
  teleportAck: string | undefined
  sheet: Sheet
  mobs: Mob[]
  others: Other[]
  drops: Drop[]
  givers: Giver[]
  /** the giver close enough to talk to */
  talk: Giver | null
  /** the nearest hero close enough to speak with */
  peer: Other | null
  /** the creature being fought, if one */
  foe: Mob | null
  /** what my next blow or ability would take (strike.ts `aimOf`), which the
   * mark shows */
  aim: Mob | null
  /** by a village's fire, where its rack of plain arms stands */
  rack: boolean
  /** how far through a blow or an ability, 0 to 1, or -1 */
  swing: number
  /** the hand it is struck with (gear.ts `handOf`) */
  hand: Hand
  /** the ability being done, or empty */
  doing: string
  /** how long until each ability on the bar can be done again, in ms */
  cool: Record<string, number>
  /** bites are turned aside */
  guard: boolean
  /** how much of a ward is left, 0 to 1 */
  ward: number
  /** how far through a dodge, 0 to 1, or -1 */
  roll: number
  events: Event[]
  /** the store's time, in ms */
  now: number
}

let SPEED = 5.6
// A strike asked for this soon before the weapon is free is struck once it
// is.
let EARLY = 250
// A dodge: a roll this long and this fast, untouchable all through it, and
// ready again this long after it began.
let ROLL = 380
let ROLL_SPEED = 9.5
let ROLL_AGAIN = 800
// A creature bites at most this often, and winds up this long before the bite
// lands.
let BITE = 1500
let WINDUP = 600
// How far past its reach a creature's bite still takes someone: it lunges.
let LUNGE = 0.6
// A blow this soon after rolling through a bite, or blocking one, is always
// a great one.
let RIPOSTE = 1200
// How long a legendary's rally takes to come back, in ms.
let RALLY = 60_000
// The blows of an ability that lands more than once land this far apart. A
// boss is held a third as long. (How long a ward lasts and how many times a
// bleed lands are the abilities', abilities.ts.)
let HITS = 130
let BOSS_HELD = 1 / 3
// A lunge covers its ground this fast, in metres a second.
let DASH = 24
// What a fight says of a creature is kept this long after it falls, so every
// page has the fall's row before its health comes back.
let KEPT = 15_000
let DOWN = 5000
let LEASH = 26
let PICK = 1.3
let PULL = 3.8
let DROP_LIFE = 120_000
let TALK = 3.6
// How near its home a player must be for a creature to be moved at all.
let ACTIVE = 45
// How far off the others, the creatures and the people who give quests are
// seen, in metres: as far as the fog shows much of them.
let SIGHT = 90
// A page that plays says where its hero is at least this often, in ms, and
// one that has said nothing for this long sleeps.
let BEAT = 1000
let ASLEEP = 3500

let round = (v: number, k = 1000) => Math.round(v * k) / k
let dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

type Where = { level: string; x: number; y: number; z: number; at: number }
let where = (b: Bundle | undefined): Where | null => {
  let p = comp(b, 'position')
  return p.x == null ? null : {
    level: str(p.level),
    x: num(p.x),
    y: num(p.y),
    z: num(p.z),
    at: num(p.at),
  }
}
let motion = (b: Bundle | undefined) => {
  let m = comp(b, 'motion')
  return {
    yaw: num(m.yaw),
    gait: str(m.gait, 'idle'),
    vy: num(m.vy),
    vx: num(m.vx),
    vz: num(m.vz),
  }
}
let vitals = (b: Bundle | undefined): Vitals | null => {
  let t = comp(b, 'vitals')
  return t.hp == null
    ? null
    : { hp: num(t.hp), max: num(t.max, 1), lvl: num(t.lvl, 1) }
}
let rec = (v: unknown): Record<string, unknown> =>
  v && typeof v == 'object' ? Object.fromEntries(Object.entries(v)) : {}
// A fight's dealings, one a creature; what a peer sent that is no list says
// none.
let dealtOf = (list: unknown): Dealt[] =>
  (Array.isArray(list) ? list : []).map(rec).map((d) => ({
    foe: str(d.foe),
    life: num(d.life),
    dmg: num(d.dmg),
    held: num(d.held),
  }))
let fight = (b: Bundle | undefined) => {
  let f = comp(b, 'fight')
  return {
    foe: str(f.foe),
    dealt: dealtOf(f.dealt),
    swing: num(f.swing),
    serial: num(f.serial),
    events: pulses(f.events),
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

// A mover's components as they should be written at `now`: rounded, and said
// to the second, so a mover that has not moved writes nothing new until the
// next second.
let placed = (
  level: string,
  b: Body,
  now: number,
  vx: number,
  vz: number,
) => ({
  position: {
    level,
    x: round(b.x),
    y: round(b.y),
    z: round(b.z),
    at: Math.floor(now / BEAT) * BEAT,
  },
  motion: {
    yaw: round(b.yaw, 100),
    gait: b.gait,
    vy: round(b.vy, 100),
    vx: round(vx, 100),
    vz: round(vz, 100),
  },
})
let same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a).every((k) => a[k] === b[k])

/** Where a hero stands by a village's fire: the one nearest `near`, or
 * home's for a hero who has stood nowhere yet.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { flat, hearthOf } from './terrain.ts'
 * let v = flat(5)
 * let by = (b: { x: number; z: number }, [x, z]: number[]) =>
 *   Math.hypot(b.x - x, b.z - z) < 6
 * assert(by(arrival(v), hearthOf('mossvale')!))
 * assert(by(arrival(v, [-60, 70]), hearthOf('birchmere')!))
 * ```
 */
export let arrival = (v: Vale, near?: Spot): Body => {
  let [hx, hz] = (near && hearthNear(...near)) ?? hearthOf(HOME) ??
    arriveOf(HOME)
  let x = hx - 1.5 + Math.random() * 3, z = hz + 3.5 + Math.random() * 1.5
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

/** The game over one store. Each frame is played round where the hero is.
 * `stand` says where a giver is at a moment, given where their home is: the
 * villagers walk (village.ts). */
export let game = (
  net: Net,
  stand = (
    _id: string,
    home: [number, number],
    _now: number,
    v: Vale,
  ): [number, number, number] => [home[0], groundAt(v, ...home), home[1]],
) => {
  let c = net.client
  let drops = c.watch('.drop', { remote: false })
  let swingAt = -1e9
  // How long the blow or ability begun at `swingAt` keeps the weapon busy,
  // the ability, if it is one, and the hand it is struck with.
  let busy = 0
  let doing = ''
  let hand: Hand = 'main'
  let struck = true
  // The creature my blow was aimed at as I swung, and what my next blow or
  // ability would take, as last worked out.
  let aimed = ''
  let aimWas = ''
  let askedAt = -1e9
  // The ability asked for, by its slot, and when.
  let asked = { slot: 0, at: -1e9 }
  // When each ability can be done again.
  let ready = new Map<string, number>()
  let guardUntil = -1e9
  let ward = { left: 0, of: 1, until: -1e9 }
  // When a legendary's rally can ward me again (rarity.ts).
  let rallies = -1e9
  // A lunge under way: which way, and how far it has still to go.
  let dash: { x: number; z: number; left: number } | null = null
  let said = -1e9
  // How far each nearby player's combat events have been seen.
  let seen = new Map<string, number>()
  let rollAt = -1e9
  let rollTo = { x: 0, z: 0 }
  let riposte = -1e9
  let rolls = new Map<string, number>()
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
  // The region the hero was in last frame, to tell when they cross into
  // another.
  let was = ''
  // Where the hero was last seen before this page, until a frame plays.
  let lastSeen: Seen | null = null
  let travelTo: { level: string; known: ReadonlySet<string> } | null = null
  let handled: string | undefined
  // Where the hero stands on the first frame: back where they were last
  // seen, when that spot lies in the region it names and they still fit
  // there, or else by the fire of that region, or of home.
  let landing = (v: Vale): Body => {
    let s = lastSeen
    if (!s) return arrival(v)
    return (regionOf(s.x, s.z) == s.level ? resumed(v, s) : null) ??
      arrival(v, hearthOf(s.level) ?? arriveOf(s.level))
  }

  // Where a mover this page moves is (its hero, the creatures it owns),
  // written when it differs from what the graph holds.
  let sampled = new Map<string, { x: number; z: number; at: number }>()
  let say = (eid: string, level: string, body: Body, change: Bundle[]) => {
    let now = net.now(), prior = sampled.get(eid)
    let dt = prior ? Math.max((now - prior.at) / 1000, 1e-3) : 1
    let jump = prior && Math.hypot(body.x - prior.x, body.z - prior.z) > 10
    let vx = prior && !jump ? (body.x - prior.x) / dt : 0
    let vz = prior && !jump ? (body.z - prior.z) / dt : 0
    sampled.set(eid, { x: body.x, z: body.z, at: now })
    let p = placed(level, body, now, vx, vz), e = c.ent(eid)
    if (
      !same(p.position, comp(e, 'position')) ||
      !same(p.motion, comp(e, 'motion'))
    ) change.push({ entity: { eid }, ...p })
  }
  // A creature back on its wandering: nothing to say about where it is.
  let hush = (eid: string, change: Bundle[]) => {
    sampled.delete(eid)
    change.push({ entity: { eid }, position: null, motion: null, hunt: null })
  }

  // The sheet, worked out again only when one of its rows changed.
  let sheetKey: unknown[] = []
  let sheet: Sheet | null = null
  let sheetOf = (): Sheet => {
    let slain = net.mine('slain'), items = net.mine('item')
    let used = net.mine('used'), journal = net.mine('journal')
    let equip = net.mine('equip'), upgraded = net.mine('upgraded')
    let learning = net.mine('learned'), respecs = net.mine('respec')
    let name = net.who(net.hero ?? '')?.name ?? 'Wanderer'
    let key = [
      slain,
      items,
      used,
      journal,
      equip,
      upgraded,
      learning,
      respecs,
      name,
    ]
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
        ...s.lvl != null && { lvl: num(s.lvl) },
      }
    })
    let spent = new Set(used.map((b) => str(comp(b, 'used').item)))
    let ups = upgradesOf(upgraded.map((b) => {
      let u = comp(b, 'upgraded')
      return {
        item: str(u.item),
        at: num(u.at),
        eid: b.entity.eid,
        ...u.gain != null && { gain: num(u.gain) },
      }
    }))
    let bag = items.filter((b) => !spent.has(b.entity.eid)).map((b): Held => {
      let i = comp(b, 'item')
      return {
        eid: b.entity.eid,
        kind: str(i.kind),
        n: num(i.n, 1),
        rarity: rarityOf(i.rarity),
        ...i.lvl != null && { lvl: num(i.lvl) },
        ...ups.get(b.entity.eid),
      }
    })
    let entries = journal.map((b) => {
      let j = comp(b, 'journal')
      return {
        quest: str(j.quest),
        step: str(j.step),
        at: num(j.at),
        ...j.xp != null && { xp: num(j.xp) },
      }
    })
    let rows = equip.map((b) => {
      let e = comp(b, 'equip')
      return { slot: str(e.slot), item: str(e.item), at: num(e.at) }
    })
    let xp = xpOf(kills, QUESTS, entries)
    let lvl = levelOf(xp)
    let known = learnedOf(
      learning.map((b) => {
        let l = comp(b, 'learned')
        return { skill: str(l.skill), at: num(l.at) }
      }),
      respecs.map((b) => num(comp(b, 'respec').at)),
      lvl,
    )
    let learned = known.map((k) => k.skill)
    let worn = wornOf(rows, bag, lvl, known)
    let kit = skilled(kitOf(worn), learned, maxHp(lvl))
    sheet = {
      name,
      xp,
      lvl,
      max: maxHp(lvl) + kit.hp,
      bag,
      worn,
      kit,
      firsts: firsts(rows, bag, lvl),
      abilities: abilitiesOf(worn),
      learned,
      points: pointsOf(lvl) - learned.length,
      quests: questsOf(QUESTS, entries, kills, bag),
      unpinned: unpinnedOf(entries),
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

  let keepItem = (
    me: string,
    kind: string,
    n: number,
    now: number,
    rarity?: Rarity,
    level?: number,
  ) => {
    let eid = crypto.randomUUID()
    let lvl = level ?? itemLevel(eid, kind)
    net.keep({
      entity: { eid },
      item: {
        kind,
        n,
        owner: me,
        at: now,
        ...rarity && { rarity },
        ...lvl != null && { lvl },
      },
    })
    return eid
  }

  // Put on a thing I carry, in its slot, or take the slot off.
  let wear = (me: string, slot: Slot, item: string) =>
    net.keep({
      entity: { eid: crypto.randomUUID() },
      equip: { player: me, slot, item, at: net.now() },
    })

  // Blows on their way: a shot in flight, the next stab of a flurry, a
  // bleed. Each lands on its creature when it is due, and may hold it; one
  // an ability strikes says which (`by`), for what a killing blow does.
  let blows: {
    eid: string
    lands: number
    dmg: number
    great: boolean
    held: number
    by?: string
  }[] = []

  let spend = (me: string, eid: string, now: number) =>
    net.keep({
      entity: { eid: crypto.randomUUID() },
      used: { item: eid, by: me, at: now },
    })

  return {
    /** the hero's current sheet, for the stage before its first frame */
    sheet: sheetOf,
    /** bring the hero back where they were last seen, on the first frame
     * played */
    resume: (s: Seen) => {
      lastSeen = s
    },
    /** ask to travel between village fires on the next frame */
    travel: (level: string, known: ReadonlySet<string>) => {
      travelTo = { level, known }
    },
    /** put on a thing I carry, in its slot; with no item, take it off */
    wear: (slot: Slot, item = '') => {
      let s = sheetOf()
      if (
        net.hero &&
        (!item || s?.bag.some((h) => h.eid == item && canWear(h, s.lvl)))
      ) wear(net.hero, slot, item)
    },
    /** take a plain thing from the rack by a village's fire, and wear it: a
     * second blade in the other hand, for a hero who knows how */
    take: (kind: string) => {
      let me = net.hero, s = sheet
      let slot = s && twins(kind, s.worn, s.learned) ? 'off' : ITEMS[kind]?.slot
      if (!me || !slot || !rack().includes(kind)) return
      wear(me, slot, keepItem(me, kind, 1, net.now(), undefined, 1))
    },
    /** spend a point on a skill, if one is left and it can be learned */
    learn: (skill: string) => {
      let me = net.hero, s = sheet
      if (!me || !s || !canLearn(skill, s.learned, s.lvl)) return
      net.keep({
        entity: { eid: crypto.randomUUID() },
        learned: { player: me, skill, at: net.now() },
      })
    },
    /** forget every skill, to spend the points again: by a village's fire */
    respec: () => {
      let me = net.hero
      if (!me) return
      net.keep({
        entity: { eid: crypto.randomUUID() },
        respec: { player: me, at: net.now() },
      })
    },
    /** take up a quest */
    accept: (q: Quest) => {
      let me = net.hero
      if (!me) return
      net.keep({
        entity: { eid: crypto.randomUUID() },
        journal: { player: me, quest: q.id, step: 'taken', at: net.now() },
      })
    },
    /** pin a quest taken, so the glass tracks it, or unpin it */
    pin: (quest: string, on: boolean) => {
      let me = net.hero
      if (!me) return
      net.keep({
        entity: { eid: crypto.randomUUID() },
        journal: {
          player: me,
          quest,
          step: on ? 'pinned' : 'unpinned',
          at: net.now(),
        },
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
        journal: {
          player: me,
          quest: q.id,
          step: 'done',
          at: now,
          xp: questXp(q),
        },
      })
      if (q.gift) keepItem(me, q.gift, 1, now)
      let giver = GIVERS.find((g) => g.id == q.giver)?.name ?? 'They'
      let gift = q.gift
        ? ` ${giver} gives you ${ITEMS[q.gift]?.name ?? q.gift}.`
        : ''
      return [{
        type: 'say',
        text: `${q.title}: done! +${questXp(q)} xp.${gift}`,
      }]
    },

    frame: (
      v: Vale,
      intent: Intent,
      look: number,
      dt: number,
    ): Frame | null => {
      let me = net.hero
      if (!me) return null
      let now = net.now()
      let events: Event[] = []
      let heard: Event[] = []
      let change: Bundle[] = []
      let s = sheetOf()
      let row = c.ent(me)
      let teleported: string | null = null
      let at = (b: { x: number; y: number; z: number }, up = 1): Vec3 => [
        b.x,
        b.y + up,
        b.z,
      ]

      // Me, as the graph has me: a hero with no place (new, or back after a
      // reload) stands where they land.
      let pos = where(row)
      let here = pos ? bodyOf(pos, motion(row)) : null
      let recalledTeleport = lastSeen?.teleport
      let teleportAck = str(comp(row, 'seen').teleport, recalledTeleport)
      let body = here ? { ...here } : landing(v)
      lastSeen = null
      let down = here?.gait == 'down'
      if (down) body.gait = 'idle'
      let vit = vitals(row)
      let hp = vit?.max && vit.max != s.max
        ? Math.min(s.max, Math.round(vit.hp * s.max / vit.max))
        : Math.min(vit?.hp ?? s.max, s.max)
      let damage = comp(row, 'damageable').on !== false
      if (!damage) {
        hp = s.max
        down = false
      }
      let mine = fight(row)
      let fought = { ...mine, dealt: mine.dealt.map((d) => ({ ...d })) }
      if (lvlWas && s.lvl > lvlWas) {
        events.push({ type: 'level', lvl: s.lvl })
        hp = s.max
      }
      lvlWas = s.lvl

      // The hero: up again at the fire after fainting, or moving as asked.
      if (down) {
        if (now - downAt > DOWN) {
          body = arrival(v, [body.x, body.z])
          hp = s.max
          down = false
          events.push({ type: 'rise' })
        }
      } else {
        let push = { ...stepPush(look, intent.move), jump: intent.jump }
        // A dodge rolls the way I am going, or back from where I face when I
        // am still, facing the same way throughout, and cuts short a blow or
        // an ability not yet landed.
        let len = Math.hypot(push.x, push.z)
        if (
          intent.dodge && body.gait != 'jump' && now - rollAt > ROLL_AGAIN
        ) {
          rollAt = now
          rollTo = len < 0.2
            ? { x: -Math.sin(body.yaw), z: -Math.cos(body.yaw) }
            : { x: push.x / len, z: push.z / len }
          swingAt = -1e9
          struck = true
          doing = ''
          dash = null
          guardUntil = -1e9
          events.push({ type: 'roll', at: at(body, 0.2) })
        }
        if (now - rollAt < ROLL) {
          let n = walk(v, body, { ...rollTo, jump: false }, dt, ROLL_SPEED)
          body = {
            ...n,
            yaw: body.yaw,
            gait: n.gait == 'jump' ? 'jump' : 'roll',
          }
        } else if (dash) {
          // A lunge: straight at what it was aimed at, facing it, until it
          // gets there or something is in the way; its blow lands then.
          let step = Math.min(dash.left, DASH * dt)
          let n = walk(
            v,
            body,
            { x: dash.x, z: dash.z, jump: false },
            dt,
            step / dt,
          )
          dash.left -= step
          if (
            dash.left <= 0 || Math.hypot(n.x - body.x, n.z - body.z) < step / 2
          ) dash = null
          body = { ...n, yaw: body.yaw }
        } else {
          body = stride(
            v,
            body,
            intent.move,
            look,
            dt,
            SPEED * (1 + s.kit.speed),
            intent.jump,
            intent.look && !intent.turn,
            intent.faceMove,
          )
          if (
            (intent.turn || intent.orbit[0] && !intent.look) &&
            !intent.move.some(Boolean)
          ) {
            let face = look + Math.PI
            body.yaw = Math.atan2(Math.sin(face), Math.cos(face))
          }
        }
      }
      if (travelTo) {
        let to = destination(
          body.x,
          body.z,
          travelTo.known,
          travelTo.level,
        )
        travelTo = null
        if (to && !down) {
          body = arrival(v, to.at)
          dash = null
          busy = 0
          doing = ''
          fought.foe = ''
        }
      }
      let request = nextTeleport(
        net.mine('teleport_request'),
        me,
        teleportAck,
        handled,
      )
      if (request) {
        handled = request.entity.eid
        let ask = comp(request, 'teleport_request')
        try {
          let to = destinationOf(v, { x: num(ask.x, NaN), z: num(ask.z, NaN) })
          if (to.level == ask.level) {
            let landed = resumed(v, { x: to.x, z: to.z, yaw: body.yaw })
            if (landed) {
              body = landed
              dash = null
              busy = 0
              doing = ''
              fought.foe = ''
              teleported = request.entity.eid
            }
          }
        } catch { /* a malformed request never moves a hero */ }
      }
      let rolling = body.gait == 'roll'

      net.follow(body.x, body.z)

      // The others within sight, as relayed.
      let others: Other[] = []
      let theirs: Dealing[] = []
      let spots = new Map<
        string,
        { x: number; z: number; prey: boolean; awake: boolean }
      >()
      spots.set(me, { x: body.x, z: body.z, prey: !down, awake: true })
      for (let b of net.players()) {
        let eid = b.entity.eid
        if (eid == me) continue
        let e = c.ent(eid)
        let p = where(e)
        if (!p || dist(p, body) > SIGHT) continue
        let m = motion(e)
        let pl = net.who(eid)
        if (!pl) continue
        let f = fight(e)
        let t = vitals(e) ?? { hp: 1, max: 1, lvl: 1 }
        if (m.gait != 'roll') rolls.delete(eid)
        else if (!rolls.has(eid)) rolls.set(eid, now)
        let rolled = rolls.has(eid) ? (now - rolls.get(eid)!) / ROLL : -1
        others.push({
          eid,
          name: pl.name,
          look: { tint: pl.tint, hair: pl.hair, skin: pl.skin },
          body: { ...bodyOf(p, m), vx: m.vx, vz: m.vz, at: p.at },
          vitals: t,
          gear: Object.fromEntries(
            Object.entries(comp(e, 'gear')).map(([k, v]) => [k, str(v)]),
          ),
          foe: f.foe,
          swing: f.swing,
          roll: Math.min(1, rolled),
        })
        theirs.push(...f.dealt.map((d) => ({ ...d, by: eid })))
        let next = replay(f.events, f.serial, seen.get(eid) ?? 0, now)
        seen.set(eid, next.seen)
        heard.push(...next.events)
        spots.set(eid, {
          x: p.x,
          z: p.z,
          prey: m.gait != 'down' && now - p.at < ASLEEP,
          awake: now - p.at < ASLEEP,
        })
      }
      let falls = fallsBy()
      // Everyone's dealings: the others', and mine as they stand.
      let dealing = (): Dealing[] => [
        ...theirs,
        ...fought.dealt.map((d) => ({ ...d, by: me })),
      ]
      let all = dealing()

      // The creatures living within sight.
      let homes = homesNear(body.x, body.z, SIGHT)
      let mobs: Mob[] = []
      for (let h of homes) {
        if (!BEASTS[h.kind]) continue
        let beast = foeOf(h.kind, h.level)
        let eid = h.eid
        let e = c.ent(eid)
        let home = { x: h.home[0], z: h.home[1] }
        let f = fallOf(falls.get(eid) ?? [], beast.respawn, now)
        let life = f.fell
        let hpNow = f.down ? 0 : hpOf(eid, beast.hp, life, all)
        let wasHp = hpWas.get(eid) ?? beast.hp
        hpWas.set(eid, hpNow)
        let fallen = f.down || hpNow <= 0
        if (fallen && !sinking.has(eid)) sinking.set(eid, f.down ? f.fell : now)
        if (!fallen) sinking.delete(eid)
        let up = wasDown.has(eid) && !fallen
        let stuck = !fallen && heldOf(eid, life, all, now)
        if (fallen) wasDown.add(eid)
        else wasDown.delete(eid)
        let p = where(e)
        let hu = hunt(e)
        let held = p && bodyOf(p, motion(e))
        let moving = !!p && !up
        // Where it is: where I have it, or where it is said to be, or where
        // it lay down, or where its wandering has it.
        let mb = held && moving
          ? { ...held }
          : fallen && last.has(eid)
          ? last.get(eid)!
          : rest(v, h.home, h.roam, h.seed, now)
        // Who moves it: of the players near its home whose pages play, the
        // first by eid.
        let owner = ''
        for (let [who, sp] of spots) {
          if (!sp.awake || dist(sp, home) > ACTIVE) continue
          if (!owner || who < owner) owner = who
        }
        // Peers show the individual blow from its sender's combat events.
        if (!fallen && hpNow < wasHp) hitAt.set(eid, now)
        if (owner == me && !fallen) {
          // Whom it is after: whoever is hurting it most, while they stay
          // near its home; else, if it is the kind that minds, whoever comes
          // close. Never someone fainted, or whose page sleeps and so takes
          // no bites.
          let quarry = ''
          let hn = hunter(eid, life, all)
          let hs = hn ? spots.get(hn) : undefined
          if (
            hn && hs?.prey && !sheltered(v, hs.x, hs.z) &&
            dist(hs, home) < h.roam + LEASH
          ) quarry = hn
          else if (beast.aggro) {
            let best = beast.aggro * (hu.player ? 1.8 : 1)
            for (let [w, sp] of spots) {
              if (!sp.prey || sheltered(v, sp.x, sp.z)) continue
              if (dist(sp, home) > h.roam + LEASH) continue
              let d = dist(sp, mb)
              if (d < best) [best, quarry] = [d, w]
            }
          }
          let qs = quarry ? spots.get(quarry) ?? null : null
          // Struck: knocked back from whoever is nearest. Held, it stays
          // where it is.
          let knocked = false
          if (hpNow < wasHp && !stuck) {
            let from: { x: number; z: number } | null = null
            for (let sp of spots.values()) {
              if (
                dist(sp, mb) < 3 && (!from || dist(sp, mb) < dist(from, mb))
              ) from = sp
            }
            if (from) {
              let k = 0.45 / Math.max(0.3, beast.size)
              let dx = mb.x - from.x, dz = mb.z - from.z
              let d = Math.hypot(dx, dz) || 1
              mb = walk(
                v,
                mb,
                { x: dx / d, z: dz / d, jump: false },
                dt,
                k / Math.max(dt, 1e-3),
                (x, z) => sheltered(v, x, z),
                false,
              )
              knocked = true
            }
          }
          if (stuck && !moving) say(eid, h.level, mb, change)
          if (!stuck && (quarry || moving || knocked)) {
            let next = prowl(v, mb, beast, h.home, h.roam, h.seed, now, dt, qs)
            let back = rest(v, h.home, h.roam, h.seed, now)
            if (!quarry && !knocked && dist(next, back) < 0.3) {
              if (p || hu.player) hush(eid, change)
              mb = back
            } else {
              mb = next
              say(eid, h.level, mb, change)
            }
          }
          // Near enough to bite: it winds up, and says when the bite lands.
          // Held, a bite it was winding up comes to nothing.
          let bite = hu.bite
          if (stuck) {
            if (hu.bite > now) bite = now - BITE
          } else if (
            qs && dist(qs, mb) <= beast.reach + 0.4 &&
            now - hu.bite > BITE - WINDUP
          ) bite = now + WINDUP
          if (quarry != hu.player || bite != hu.bite) {
            change.push({
              entity: { eid },
              hunt: quarry ? { player: quarry, bite } : null,
            })
          }
        }
        // Up again after a fall: back to its wandering, from home.
        if (owner == me && up && (p || hu.player)) hush(eid, change)
        // A bite, once it lands: the one aimed at me is mine to take, unless
        // I rolled through it, blocked it, or stepped out of its reach, or it
        // was held. Rolling through one or blocking it leaves the creature
        // open. A ward takes what it can of the rest.
        let seen = bitten.get(eid) ?? Math.min(hu.bite, now)
        bitten.set(eid, seen)
        if (hu.bite > seen && hu.bite <= now) {
          bitten.set(eid, hu.bite)
          let near = dist(mb, body) <= beast.reach + LUNGE
          if (
            hu.player == me && damage && !down && hp > 0 &&
            !fallen && near && !stuck &&
            !sheltered(v, body.x, body.z)
          ) {
            if (rolling) {
              riposte = now
              events.push({ type: 'dodge', at: at(body, 2) })
              let n = Math.min(s.max - hp, s.max * (s.kit.powers.dodge ?? 0))
              if (n >= 1) {
                hp += Math.round(n)
                events.push({ type: 'heal', n: Math.round(n), at: at(body, 2) })
              }
            } else if (now < guardUntil) {
              riposte = now
              events.push({ type: 'block', at: at(body, 2) })
            } else {
              let dmg = biteOf(
                Math.round(beast.dmg * (0.85 + Math.random() * 0.3)),
                beast.lvl,
                s.lvl,
                s.kit.armour,
              )
              dmg = Math.min(dmg, hp + (now < ward.until ? ward.left : 0))
              let soak = now < ward.until ? Math.min(ward.left, dmg) : 0
              if (soak) {
                ward.left -= soak
                dmg -= soak
                events.push({ type: 'ward', n: soak, at: at(body, 2.3) })
              }
              if (dmg) {
                hp -= dmg
                hurtAt = now
                events.push({ type: 'hurt', dmg, at: at(body, 2) })
                // A legendary bites back, and one wards me when I am low.
                let { thorns = 0, rally = 0 } = s.kit.powers
                let back = Math.round(dmg * thorns)
                if (back) {
                  blows.push({
                    eid,
                    lands: now,
                    dmg: back,
                    great: false,
                    held: 0,
                  })
                }
                if (rally && hp > 0 && hp < s.max / 3 && now > rallies) {
                  rallies = now + RALLY
                  let n = Math.round(s.max * rally)
                  ward = { left: n, of: n, until: now + WARD }
                  events.push({ type: 'ward', n, at: at(body, 2.3) })
                }
              }
            }
          }
        }
        let biting = now - hu.bite
        let bite = hu.bite && biting > -WINDUP && biting < WINDUP * 1.5
          ? (biting + WINDUP) / (WINDUP * 2.5)
          : -1
        last.set(eid, mb)
        mobs.push({
          eid,
          kind: h.kind,
          land: h.level,
          lvl: beast.lvl,
          home: h.home,
          body: mb,
          hp: hpNow,
          most: beast.hp,
          down: fallen,
          since: sinking.get(eid) ?? 0,
          hurt: now - (hitAt.get(eid) ?? -1e9),
          bite,
          aim: hu.player == me,
          reach: beast.reach + LUNGE,
          near: dist(mb, body),
          held: stuck,
        })
      }

      // A fall I had a hand in: my row saying so, and my share of the loot.
      let fell = (m: Mob, life: number, when: number) => {
        let key = `${m.eid}:${life}`
        if (shares.has(key)) return
        shares.add(key)
        let beast = foeOf(m.kind, m.land)
        net.keep({
          entity: { eid: crypto.randomUUID() },
          slain: {
            creature: m.eid,
            by: me,
            kind: m.kind,
            at: when,
            xp: beast.xp,
            lvl: beast.lvl,
          },
          place: placeOf(...m.home),
        })
        events.push({
          type: 'fall',
          eid: m.eid,
          beast: m.kind,
          at: at(m.body, 0.5),
        })
        // What the kill is worth to me, at the level I am before it.
        events.push({
          type: 'xp',
          n: worth(beast.xp, beast.lvl, s.lvl),
          at: at(m.body, beast.size + 1),
        })
        let find = s.kit.powers.find ?? 0
        lootOf(beast, m.eid, when, me, s.kit.family, find).forEach((l, i) => {
          let a = (i / 3) * Math.PI * 2 + Math.random()
          let x = m.body.x + Math.cos(a) * 0.9, z = m.body.z + Math.sin(a) * 0.9
          change.push({
            entity: { eid: crypto.randomUUID() },
            drop: {
              kind: l.kind,
              n: l.n,
              at: now,
              ...l.rarity && { rarity: l.rarity },
            },
            position: { level: regionOf(x, z), x, y: groundAt(v, x, z), z },
          })
          if (l.rarity && l.rarity != 'common') {
            events.push({
              type: 'spoil',
              rarity: l.rarity,
              at: [x, groundAt(v, x, z), z],
            })
          }
        })
      }

      // A blow landing on a creature: what I have dealt it in this life of
      // it, and, when the blow holds it, until when.
      let land = (m: Mob, dmg: number, great: boolean, held = 0, by = '') => {
        let beast = foeOf(m.kind, m.land)
        let life = fallOf(falls.get(m.eid) ?? [], beast.respawn, now).fell
        let d = fought.dealt.find((d) => d.foe == m.eid && d.life == life)
        if (!d) fought.dealt.push(d = { foe: m.eid, life, dmg: 0, held: 0 })
        d.dmg += dmg
        if (!down) hp = Math.min(s.max, hp + dmg * (s.kit.powers.leech ?? 0))
        m.hp = hpOf(m.eid, beast.hp, life, dealing())
        hitAt.set(m.eid, now)
        m.hurt = 0
        events.push({
          type: 'hit',
          eid: m.eid,
          beast: m.kind,
          at: at(m.body, beast.size + 0.4),
          dmg,
          great,
          by,
        })
        if (m.hp <= 0) {
          m.down = true
          m.since = now
          sinking.set(m.eid, now)
          fell(m, life, now)
        } else if (held) {
          d.held = Math.max(d.held, now + held * (beast.boss ? BOSS_HELD : 1))
          m.held = true
          events.push({ type: 'held', at: at(m.body, beast.size + 1) })
        }
      }

      // My weapon, when it is free and I am not rolling: an ability asked
      // for, when it is ready, or else a blow. I turn toward what it is aimed
      // at, and a moment in, it lands, or its shot is loosed. With a blade in
      // each hand, blows come a hand at a time (gear.ts `handOf`), each as
      // hard as its own blade; an ability lands as hard as the first's.
      let k = s.kit
      let face = (m: Mob) =>
        body.yaw = turn(
          body.yaw,
          Math.atan2(m.body.x - body.x, m.body.z - body.z),
          1.9,
        )
      // How an ability's blow went: ready again at once, if its row says so
      // for how it went (abilities.ts `again`).
      let went = (id: string, how: Went) => {
        let a = formOf(id, s.learned)
        if (a && again(a, how)) ready.set(id, now)
      }
      // What my next blow or ability would take, worked out once: the mark
      // shows it, and whatever I do now is aimed at it. It looks as far as a
      // blow reaches, or an ability on the bar that is ready or under way.
      let under = now - swingAt < busy ? doing : ''
      let aim = down ? null : aimOf(
        mobs,
        body,
        k,
        aimWas,
        s.abilities.flatMap((id) => {
          let a = formOf(id, s.learned)
          return a && (id == under || (ready.get(id) ?? 0) <= now) ? [a] : []
        }),
      )
      aimWas = aim?.eid ?? ''
      if (intent.strike) askedAt = now
      if (intent.ability) asked = { slot: intent.ability, at: now }
      if (
        !down && !rolling && !dash && now - swingAt > busy &&
        now - asked.at < k.pace + EARLY
      ) {
        let id = s.abilities[asked.slot - 1] ?? ''
        let a = formOf(id, s.learned)
        asked = { slot: 0, at: -1e9 }
        let target = a ? aimFor(aim, k, a) : null
        if (!a || (ready.get(id) ?? 0) > now) {
          // Nothing in that slot, or not ready: the bar shows which.
        } else if (!target && aims(a)) {
          if (now - said > 2000) {
            said = now
            events.push({
              type: 'say',
              text: `${a.name}: nothing in reach.`,
            })
          }
        } else {
          let from = at(body)
          swingAt = now
          busy = a.time ?? k.pace
          doing = id
          struck = false
          guardUntil = -1e9
          askedAt = -1e9
          aimed = target?.eid ?? ''
          ready.set(id, now + a.cool)
          fought.swing++
          hand = handOf(k, fought.swing)
          if (target) face(target)
          if (target && a.dash) {
            let gap = BEASTS[target.kind].size * 0.5 + 0.9
            let ang = Math.atan2(
              target.body.x - body.x,
              target.body.z - body.z,
            )
            if (a.behind) {
              // Behind it, facing it.
              body.x = target.body.x + Math.sin(ang) * gap
              body.z = target.body.z + Math.cos(ang) * gap
              body.y = groundAt(v, body.x, body.z)
              body.yaw = ang + Math.PI
            } else {
              body.yaw = ang
              dash = {
                x: Math.sin(ang),
                z: Math.cos(ang),
                left: Math.max(0, target.near - gap),
              }
            }
          }
          if (a.guard) guardUntil = now + a.guard
          if (a.ward) {
            let n = Math.round(s.max * a.ward)
            ward = { left: n, of: n, until: now + WARD }
          }
          if (a.heal) {
            let n = Math.min(s.max - hp, Math.round(s.max * a.heal))
            hp += n
            if (n) events.push({ type: 'heal', n, at: at(body, 2) })
          }
          events.push({
            type: 'ability',
            id,
            by: me,
            at: at(body, 0),
            ...a.dash && { from },
            yaw: body.yaw,
          })
        }
      }
      if (
        !down && !rolling && !dash && now - askedAt < EARLY &&
        now - swingAt > busy
      ) {
        askedAt = -1e9
        swingAt = now
        busy = k.pace
        doing = ''
        struck = false
        guardUntil = -1e9
        fought.swing++
        hand = handOf(k, fought.swing)
        let target = aimFor(aim, k)
        aimed = target?.eid ?? ''
        if (target) face(target)
      }
      if (!struck && !dash && now - swingAt >= k.pace * LAND) {
        struck = true
        let a = formOf(doing, s.learned)
        let target = mobs.find((m) => m.eid == aimed) ?? null
        let taken = a
          ? takenBy(a, mobs, body, k, target)
          : [landOf(mobs, body, k, aimed)].flatMap((m) => m ? [m] : [])
        // An ability that took nothing it was aimed at, stopped short by the
        // world or with its foe gone, went wide.
        if (
          a && a.shape != 'self' && !taken.some((m) => !aimed || m.eid == aimed)
        ) {
          went(doing, 'miss')
        }
        let sure = taken.length > 0 && now - riposte < RIPOSTE
        if (sure) riposte = -1e9
        let lead = taken.find((m) => m.eid == aimed) ?? taken[0]
        if (lead) fought.foe = lead.eid
        // A shot flies at the creature it was aimed at, or straight on at
        // nothing, and what it takes, it takes when it gets there.
        let to = lead ? at(lead.body, BEASTS[lead.kind].size * 0.6) : at({
          x: body.x + Math.sin(body.yaw) * k.reach,
          y: body.y,
          z: body.z + Math.cos(body.yaw) * k.reach,
        })
        let flies = !a || a.shape == 'one' || a.shape == 'burst'
          ? k.shot
          : undefined
        let ms = flies
          ? (Math.hypot(to[0] - body.x, to[2] - body.z) / FLIGHT[flies]) * 1000
          : 0
        for (let i = 0; flies && i < (a?.shots ?? 1); i++) {
          let r = i ? (a?.far ?? 0) * Math.sqrt(Math.random()) : 0
          let t = Math.random() * Math.PI * 2
          events.push({
            type: 'shot',
            kind: flies,
            flame: doing == 'blaze',
            from: at(body),
            to: [to[0] + Math.cos(t) * r, to[1], to[2] + Math.sin(t) * r],
            ms: ms * (1 + i * 0.07),
          })
        }
        if (a?.shape == 'burst') {
          events.push({ type: 'burst', id: doing, at: to, r: a.far ?? 0, ms })
        }
        if (!taken.length && a?.shape != 'self') {
          events.push({ type: 'whiff', family: k.family })
        }
        let might = blowOf(s.lvl, k, !a && hand == 'off' ? k.twin : k.dmg)
        for (let [j, m] of taken.entries()) {
          let hits = (a?.hits ?? 1) + +(Math.random() < (k.powers.echo ?? 0))
          for (let i = 0; i < hits; i++) {
            let last = i == hits - 1
            let { dmg, great } = blow(
              might * (a?.dmg ?? 1),
              Math.random(),
              (sure && !j && !i) || (!!a?.sure && last),
              k.luck,
            )
            blows.push({
              eid: m.eid,
              lands: now + ms + i * HITS,
              dmg,
              great,
              held: i
                ? 0
                : Math.max(a?.held ?? 0, great ? k.powers.hold ?? 0 : 0),
              by: doing,
            })
          }
          let burns = (a?.bleed ?? 0) + (k.powers.burn ?? 0)
          let bleed = Math.round((might * burns) / BLEEDS)
          for (let i = 1; bleed && i <= BLEEDS; i++) {
            blows.push({
              eid: m.eid,
              lands: now + ms + i * 1000,
              dmg: bleed,
              great: false,
              held: 0,
            })
          }
        }
      }
      // Blows arriving. One an ability struck that fells what it lands on is
      // that ability's killing blow.
      blows = blows.filter((b) => {
        if (b.lands > now) return true
        let m = mobs.find((m) => m.eid == b.eid)
        if (m && !m.down) {
          land(m, b.dmg, b.great, b.held, b.by)
          if (m.down && b.by) went(b.by, 'kill')
        }
        return false
      })

      // Someone else's blow felled what I was hurting: my share.
      for (let d of fought.dealt) {
        let m = d.dmg > 0 && mobs.find((m) => m.eid == d.foe)
        if (!m) continue
        let f = fallOf(falls.get(m.eid) ?? [], BEASTS[m.kind].respawn, now)
        if (f.down && f.fell > d.life) fell(m, d.life, f.fell)
        else if (m.down && f.fell == d.life) fell(m, d.life, now)
      }
      // What I say I dealt each creature, kept while it lives, and a while
      // after it falls.
      fought.dealt = fought.dealt.filter((d) => {
        let m = mobs.find((m) => m.eid == d.foe)
        let f = m && fallOf(falls.get(d.foe) ?? [], BEASTS[m.kind].respawn, now)
        return !!f && (f.fell == d.life || now - f.fell < KEPT)
      })

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
        if (d.kind == null || !p || dist(p, body) > SIGHT) continue
        let drop: Drop = {
          eid: b.entity.eid,
          kind: str(d.kind),
          n: num(d.n, 1),
          rarity: d.rarity == null ? undefined : rarityOf(d.rarity),
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
          events.push({
            type: 'loot',
            item: drop.kind,
            n: drop.n,
            at: at(drop, 0.6),
            piece: keepItem(me, drop.kind, drop.n, now, drop.rarity),
            rarity: drop.rarity,
          })
        } else {
          if (!down && dd < PULL && now - drop.at > 350) {
            let k = Math.min(1, (dt * 7) / dd)
            drop.x += (body.x - drop.x) * k
            drop.z += (body.z - drop.z) * k
            drop.y = Math.max(groundAt(v, drop.x, drop.z), drop.y)
            change.push({
              entity: { eid: drop.eid },
              position: {
                level: regionOf(drop.x, drop.z),
                x: drop.x,
                y: drop.y,
                z: drop.z,
              },
            })
          }
          lying.push(drop)
        }
      }

      // The people within sight who give quests.
      let givers: Giver[] = GIVERS.flatMap((g) => {
        let [px, pz] = spotOf(g.level, g.place) ?? [Infinity, Infinity]
        if (Math.hypot(px - body.x, pz - body.z) > SIGHT + 45) return []
        let home: [number, number] = [px + g.offset[0], pz + g.offset[1]]
        let [x, y, z] = stand(g.id, home, now, v)
        if (Math.hypot(x - body.x, z - body.z) >= SIGHT) return []
        // Where they stood a moment ago says the way they walk.
        let [wx, , wz] = stand(g.id, home, now - 250, v)
        let h = heed(x, z, spots.values())
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
        return [{
          id: g.id,
          name: g.name,
          x,
          y,
          z,
          greets: g.greets,
          look: g.look,
          build: g.build,
          staff: !!g.staff,
          next,
          mark,
          near: Math.hypot(x - body.x, z - body.z),
          walk: Math.hypot(x - wx, z - wz) > 0.02
            ? Math.atan2(x - wx, z - wz)
            : null,
          heed: h && { x: h.x, z: h.z, talk: h.near < TALK },
        }]
      })
      let talk = down ? null : givers
        .filter((g) => g.near < TALK)
        .sort((a, b) => a.near - b.near)[0] ?? null
      let peer = down ? null : others
        .filter((o) =>
          Math.hypot(
            o.body.x - body.x,
            o.body.z - body.z,
          ) < TALK
        )
        .sort((a, b) =>
          Math.hypot(a.body.x - body.x, a.body.z - body.z) -
          Math.hypot(b.body.x - body.x, b.body.z - body.z)
        )[0] ?? null

      // Into another region: its name, as the hero comes into it.
      let level = regionOf(body.x, body.z)
      if (was && level != was) {
        events.push({ type: 'travel', to: level })
      }
      was = level

      // What I wear: the first I carry for each slot I never chose for, and
      // for the others, the kind in each.
      if (net.settled()) {
        for (let f of s.firsts) {
          wear(me, f.slot, f.item)
          let h = s.bag.find((h) => h.eid == f.item)
          events.push({
            type: 'wear',
            item: h?.kind ?? '',
            piece: f.item,
            rarity: h?.rarity,
          })
        }
      }
      let gearNow = Object.fromEntries(
        SLOTS.map((sl) => [sl, s.worn[sl]?.kind ?? '']),
      )
      if (!same(gearNow, comp(row, 'gear'))) {
        change.push({ entity: { eid: me }, gear: gearNow })
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
      let next = publish(events, fought.events, fought.serial, now)
      fought.events = next.events
      fought.serial = next.serial
      if (JSON.stringify(fought) != JSON.stringify(mine)) {
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
        teleported,
        teleportAck,
        sheet: s,
        mobs,
        others,
        drops: lying,
        givers,
        talk,
        peer,
        foe,
        aim,
        rack: !down && inVillage(body.x, body.z),
        swing: now - swingAt < busy ? (now - swingAt) / busy : -1,
        hand,
        doing: now - swingAt < busy ? doing : '',
        cool: Object.fromEntries(
          s.abilities.filter((id) => id).map((id) => [
            id,
            Math.max(0, (ready.get(id) ?? 0) - now),
          ]),
        ),
        guard: now < guardUntil,
        ward: now < ward.until ? ward.left / ward.of : 0,
        roll: rolling ? (now - rollAt) / ROLL : -1,
        events: [...heard, ...events],
        now,
      }
    },
  }
}
