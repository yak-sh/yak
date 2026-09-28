// A hero's work: at the nodes round them (gather.ts), and at a
// village's stations, making things (craft.ts) or upgrading them
// (upgrade.ts); and, with the same hands, reading a village's notice board
// (notices.ts). This reads where the hero stands and what they asked for:
// which node, station or board is near enough to work, the work under way,
// and what it yields. When a node's work is done it writes the
// item it gave, wearing the `gathered` row that spends the node for everyone
// until it grows back; when a thing is made, the item made, wearing its
// `crafted` row, with `used` rows for what it took, in one write; when a piece
// is upgraded, the `upgraded` row naming it, and the `used` rows. Each is xp
// to its trade. The work stops when the hero walks off, strikes, rolls, jumps
// or faints, or someone else gathers the node first.
import { isStation, madeXp, plan, RECIPES, spare, STATIONS } from './craft.ts'
import { placeOf, REACH } from './area.ts'
import {
  chipOf,
  effort,
  GATHER,
  gatherXp,
  haulOf,
  type Lode,
  LODES,
  naturalEid,
  nodeRarity,
  nodesNear,
} from './gather.ts'
import { ITEMS } from './items.ts'
import { comp, num, str } from './bundle.ts'
import type { Bundle, Net } from './net.ts'
import { type Natural, NATURE } from './nature.ts'
import { type Board, boardsNear, READ } from './notices.ts'
import type { Frame, Vec3 } from './play.ts'
import { itemLevel, made, type Rarity } from './rarity.ts'
import { upgradeOf, upgradeWorth, upgradeXp } from './upgrade.ts'
import { fallOf } from './rules.ts'
import {
  groundAt,
  type Prop,
  stationsNear,
  type Vale,
  WATER,
} from './terrain.ts'
import {
  ALL,
  type Craft,
  type Gather,
  least,
  type Trade,
  TRADES,
  type Trades,
  tradesOf,
} from './trades.ts'

/** A node as this frame sees it: which, where it stands on the ground or the
 * water, whether it is spent and for how many ms more, how far from the hero
 * it is, middle to middle, and its rarity for this life. */
export type Seen = {
  eid: string
  kind: string
  lode: Lode
  at: Vec3
  life: number
  spent: boolean
  back: number
  near: number
  rarity: Rarity
  prop?: Prop
}

/** A station near enough to work: which, where, and how far off. */
export type Bench = { craft: Craft; at: Vec3; near: number }

/** A notice board near enough to read, and how far off. */
export type Reading = Board & { near: number }

/** The part of a game frame that work needs, for a hero or a companion. */
export type WorkFrame = {
  body: Pick<Frame['body'], 'x' | 'y' | 'z'>
  sheet: Pick<Frame['sheet'], 'bag' | 'worn'>
  down: boolean
  now: number
}

/** What happened at the work this frame, for the eyes and ears: a stroke
 * landing (a chop, a clink, a rustle, a splash, a hammer on the anvil), with
 * the colour of what it throws up; a thing gathered or made, and what it was
 * worth to its trade; a station worked, to open its sheet; a board worked,
 * to open its notices; a trade grown a level; or something to tell the
 * player. */
export type Work =
  | { type: 'stroke'; eid: string; trade: Trade; at: Vec3; chip: number }
  | {
    type: 'got'
    eid: string
    item: string
    n: number
    trade: Trade
    xp: number
    at: Vec3
    /** a piece made: its item row, and how fine it came out */
    piece?: string
    rarity?: Rarity
  }
  /** a piece upgraded a step, to `plus` */
  | {
    type: 'upgraded'
    piece: string
    item: string
    rarity?: Rarity
    plus: number
    trade: Trade
    xp: number
    at: Vec3
  }
  | { type: 'station'; craft: Craft }
  | { type: 'board' }
  | { type: 'trade'; trade: Trade; lvl: number }
  | { type: 'say'; text: string }

/** The work as this frame has it: the level's nodes, the node, the station
 * and the board near enough to work, the work under way (at a node, or on a
 * recipe) and how far through, 0 to 1, with how far through the stroke it is
 * (the hero's swing, or -1 while a line waits in the water), the hero's
 * trades, and what happened. */
export type Job = {
  nodes: Seen[]
  near: Seen | null
  bench: Bench | null
  board: Reading | null
  doing: {
    trade: Trade
    at: Vec3
    node: Seen | null
    recipe: string | null
    /** the piece being upgraded, if it is one */
    piece: string | null
    k: number
    swing: number
  } | null
  trades: Trades
  events: Work[]
}

// How long a stroke of each trade's work takes, in ms, and how far into it
// the blow lands. A fish is fished with one cast of the line, as long as a
// swing (`CAST`), and after it each stroke is the float bobbing.
let STROKE: Record<Trade, number> = {
  wood: 560,
  ore: 600,
  herb: 700,
  fish: 900,
  forge: 480,
  bench: 620,
  cauldron: 760,
  loom: 650,
}
let LANDS = 0.33
let CAST = 520
// A hero this far from where the work began, in metres, has walked off.
let STRAY = 0.5
// How far round the hero the nodes are seen, on the stage and the map, in
// metres.
let SEEN = REACH

let secs = (ms: number) => {
  let s = Math.ceil(ms / 1000)
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// How long making a thing of `tier` takes, in ms.
let making = (tier: number) => 1400 + 300 * tier

// What an item row was worth to a trade: its gathering, or its making.
let worth = (b: Bundle): [Trade, number][] => {
  let gathered = comp(b, 'gathered')
  let lode = LODES[str(gathered.kind)]
  let r = RECIPES[str(comp(b, 'crafted').recipe)]
  let out: [Trade, number][] = []
  if (lode) out.push([lode.trade, num(gathered.xp, gatherXp(lode.tier))])
  if (r) out.push([r.at, madeXp(r.tier)])
  return out
}

// What a plan spends (craft.ts `plan`), as rows: a used row for each item
// row it takes, and an item row for what is left of a stack taken whole.
let spending = (
  took: { spend: string[]; change: [string, number][] },
  me: string,
  now: number,
) => [
  ...took.spend.map((eid) => ({
    entity: { eid: crypto.randomUUID() },
    used: { item: eid, by: me, at: now },
  })),
  ...took.change.map(([kind, n]) => ({
    entity: { eid: crypto.randomUUID() },
    item: { kind, n, owner: me, at: now },
  })),
]

let short: Work = { type: 'say', text: 'You no longer have all it needs.' }

/** A hero's work over one store. */
export let working = (
  net: Pick<Net, 'hero' | 'mine' | 'gathered' | 'keep'>,
) => {
  let job: {
    trade: Trade
    at: Vec3
    eid: string
    recipe: string | null
    piece: string | null
    from: number
    until: number
    x: number
    z: number
    strokes: number
    directive: string | null
  } | null = null
  // A recipe the sheet asked to make, or a piece to upgrade, taken up at the
  // next frame.
  let asked: { recipe: string; piece: string | null } | null = null

  // My trades, from what my items were worth and my upgrades, worked out
  // again only when either changed; and the last ones, to see a level
  // gained.
  let key: Bundle[][] = []
  let trades = tradesOf([])
  let was: Trades | null = null
  let tradesOfMine = () => {
    let items = net.mine('item'), ups = net.mine('upgraded')
    if (items == key[0] && ups == key[1]) return trades
    key = [items, ups]
    let kinds = new Map(
      items.map((b) => [b.entity.eid, str(comp(b, 'item').kind)]),
    )
    let rows = ups.map((b) => {
      let u = comp(b, 'upgraded')
      return { item: str(u.item), at: num(u.at) }
    })
    trades = tradesOf([...items.flatMap(worth), ...upgradeWorth(rows, kinds)])
    return trades
  }

  // Each node's gatherings, from everyone's rows and mine still waiting.
  let rowsWas: Bundle[] | null = null
  let by = new Map<string, { at: number }[]>()
  let gatherings = () => {
    let rows = net.gathered()
    if (rows == rowsWas) return by
    rowsWas = rows
    by = new Map()
    for (let b of rows) {
      let g = comp(b, 'gathered'), eid = str(g.node)
      if (!by.has(eid)) by.set(eid, [])
      by.get(eid)!.push({ at: num(g.at) })
    }
    return by
  }
  let life = (
    rows: Map<string, { at: number }[]>,
    eid: string,
    trade: Gather,
    now: number,
  ) => fallOf(rows.get(eid) ?? [], GATHER[trade].respawn, now)

  // A node's work done: the item it gave, wearing the row that spends it.
  let gather = (
    n: Seen,
    me: string,
    now: number,
    mine: Trades,
    directive: string | null,
  ): Work => {
    let lvl = mine[n.lode.trade].lvl
    let count = haulOf(n.eid, now, me, n.kind, lvl, n.rarity)
    let xp = gatherXp(n.lode.tier, n.rarity, lvl)
    net.keep({
      entity: { eid: crypto.randomUUID() },
      item: { kind: n.lode.gives, n: count, owner: me, at: now },
      gathered: {
        node: n.eid,
        life: n.life,
        kind: n.kind,
        at: now,
        rarity: n.rarity,
        xp,
        ...directive ? { directive } : {},
      },
      place: placeOf(n.at[0], n.at[2]),
    })
    return {
      type: 'got',
      eid: n.eid,
      item: n.lode.gives,
      n: count,
      trade: n.lode.trade,
      xp,
      at: n.at,
    }
  }

  // A thing made, from what the bag holds now: the item, wearing the row
  // that says how, what it took spent, and what was left of a stack taken
  // whole given back. A piece of gear comes out finer the further the
  // hero's trade is past what the recipe asks (rarity.ts).
  let make = (
    key: string,
    me: string,
    now: number,
    at: Vec3,
    f: WorkFrame,
    lvl: number,
  ): Work => {
    let r = RECIPES[key]
    let took = plan(r, spare(f.sheet.bag, Object.values(f.sheet.worn)))
    if (!took) return short
    let piece = crypto.randomUUID()
    let level = itemLevel(piece, r.makes)
    let rarity = ITEMS[r.makes]?.slot
      ? made(Math.random(), lvl, least(r.tier))
      : undefined
    net.keep(
      {
        entity: { eid: piece },
        item: {
          kind: r.makes,
          n: 1,
          owner: me,
          at: now,
          ...rarity && { rarity },
          ...level != null && { lvl: level },
        },
        crafted: { recipe: key, at: now },
      },
      ...spending(took, me, now),
    )
    return {
      type: 'got',
      eid: '',
      item: r.makes,
      n: 1,
      trade: r.at,
      xp: madeXp(r.tier),
      at,
      piece,
      rarity,
    }
  }

  // A piece upgraded a step, from what the bag holds now: the row naming it,
  // what it took spent, and what was left of a stack taken whole given back.
  let upgrade = (
    eid: string,
    me: string,
    now: number,
    at: Vec3,
    f: WorkFrame,
  ): Work => {
    let h = f.sheet.bag.find((h) => h.eid == eid)
    let r = h && upgradeOf(h.kind, h.plus ?? 0)
    let took = r && plan(r, spare(f.sheet.bag, Object.values(f.sheet.worn)))
    if (!h || !r || !took) return short
    net.keep(
      {
        entity: { eid: crypto.randomUUID() },
        upgraded: { item: eid, by: me, at: now },
      },
      ...spending(took, me, now),
    )
    let plus = (h.plus ?? 0) + 1
    return {
      type: 'upgraded',
      piece: eid,
      item: h.kind,
      rarity: h.rarity,
      plus,
      trade: r.at,
      xp: upgradeXp(r.tier, plus),
      at,
    }
  }

  return {
    /** Whether a natural prop is spent in the gathering state the nodes use. */
    spent: (p: Prop, now: number) => {
      let lode = LODES[NATURE[p.kind]]
      return !!lode && life(gatherings(), naturalEid(p), lode.trade, now).down
    },
    /** make a thing by a recipe, at the station the hero stands at */
    make: (recipe: string) => {
      asked = { recipe, piece: null }
    },
    /** upgrade a piece the hero carries a step, at the station that makes
     * one like it */
    upgrade: (piece: string) => {
      asked = { recipe: '', piece }
    },
    /** A frame of work: `want` is the player asking to work what is near,
     * `stop` their doing something else. */
    tick: (
      v: Vale,
      f: WorkFrame,
      want: boolean,
      stop: boolean,
      natural: Natural[] = [],
      as?: { target: string; directive: string },
    ): Job => {
      let me = net.hero
      let now = f.now
      let events: Work[] = []
      let mine = tradesOfMine()
      let before = was ?? mine
      for (let t of ALL) {
        if (mine[t].lvl > before[t].lvl) {
          events.push({ type: 'trade', trade: t, lvl: mine[t].lvl })
        }
      }
      was = mine
      let rows = gatherings()
      let nodes = nodesNear(f.body.x, f.body.z, SEEN, natural, as?.target).map(
        (n): Seen => {
          let lode = LODES[n.lode]
          let respawn = GATHER[lode.trade].respawn * 1000
          let fall = life(rows, n.eid, lode.trade, now)
          let y = lode.trade == 'fish'
            ? WATER
            : n.ground ?? groundAt(v, n.x, n.z)
          return {
            eid: n.eid,
            kind: n.lode,
            lode,
            at: [n.x, y, n.z],
            life: fall.fell,
            spent: fall.down,
            back: fall.down ? fall.fell + respawn - now : 0,
            near: Math.hypot(n.x - f.body.x, n.z - f.body.z),
            rarity: nodeRarity(n.eid, fall.fell),
            prop: n.prop,
          }
        },
      )
      let near = nodes
        .filter((n) =>
          n.near <= GATHER[n.lode.trade].reach &&
          (!as || n.eid == as.target)
        )
        .sort((a, b) => a.near - b.near)[0] ?? null
      let bench = (as ? [] : stationsNear(v, f.body.x, f.body.z, 12)).flatMap(
        (s): Bench[] => {
          let d = Math.hypot(s.x - f.body.x, s.z - f.body.z)
          return d <= STATIONS[s.craft].reach && Math.abs(s.y - f.body.y) < 2
            ? [{ craft: s.craft, at: [s.x, s.y, s.z], near: d }]
            : []
        },
      ).sort((a, b) => a.near - b.near)[0] ?? null
      let board = (as ? [] : boardsNear(v, f.body.x, f.body.z, READ)).flatMap(
        (b): Reading[] =>
          Math.abs(b.at[1] - f.body.y) < 2
            ? [{
              ...b,
              near: Math.hypot(b.at[0] - f.body.x, b.at[2] - f.body.z),
            }]
            : [],
      ).sort((a, b) => a.near - b.near)[0] ?? null

      // Work stops when the hero does something else, or the node is gone.
      if (job) {
        let eid = job.eid
        let n = job.recipe ? null : nodes.find((n) => n.eid == eid)
        let strayed = Math.hypot(f.body.x - job.x, f.body.z - job.z) > STRAY
        let gone = !job.recipe && !n
        if (gone || stop || f.down || strayed) {
          job = null
        } else if (n?.spent) {
          job = null
          events.push({
            type: 'say',
            text: `Someone got to the ${n.lode.name.toLowerCase()} first.`,
          })
        }
      }

      // Asked to work: the nearest whole node, or the station or board there.
      if (want && !job && !f.down && me) {
        if (!near && bench) {
          events.push({ type: 'station', craft: bench.craft })
        } else if (!near && board) {
          events.push({ type: 'board' })
        } else if (!near) {
          events.push({ type: 'say', text: 'Nothing to gather here.' })
        } else if (near.spent) {
          events.push({
            type: 'say',
            text: `${near.lode.name}: spent. It grows back in ${
              secs(near.back)
            }.`,
          })
        } else {
          job = {
            trade: near.lode.trade,
            at: near.at,
            eid: near.eid,
            recipe: null,
            piece: null,
            from: now,
            until: now + effort(near.lode, mine[near.lode.trade].lvl),
            x: f.body.x,
            z: f.body.z,
            strokes: 0,
            directive: as?.directive ?? null,
          }
        }
      }

      // Asked to make a thing, or to upgrade a piece: at its station, with
      // the trade and the stuff it asks.
      let held = f.sheet.bag.find((h) => h.eid == asked?.piece)
      let r = held
        ? upgradeOf(held.kind, held.plus ?? 0)
        : RECIPES[asked?.recipe ?? '']
      asked = null
      if (r && !job && !f.down && me && bench?.craft == r.at) {
        if (mine[r.at].lvl < least(r.tier)) {
          events.push({
            type: 'say',
            text: `That requires ${TRADES[r.at].name} ${least(r.tier)}.`,
          })
        } else if (!plan(r, spare(f.sheet.bag, Object.values(f.sheet.worn)))) {
          events.push({ type: 'say', text: 'You have not got all it needs.' })
        } else {
          job = {
            trade: r.at,
            at: bench.at,
            eid: '',
            recipe: r.makes,
            piece: held?.eid ?? null,
            from: now,
            until: now + making(r.tier),
            x: f.body.x,
            z: f.body.z,
            strokes: 0,
            directive: null,
          }
        }
      }

      // The work under way: a stroke landing, and at the end what it gave.
      let doing: Job['doing'] = null
      if (job && me) {
        let { trade, at, eid, recipe, piece, directive } = job
        let n = recipe ? null : nodes.find((n) => n.eid == eid) ?? null
        let stroke = STROKE[trade]
        let into = now - job.from
        let landed = Math.floor(into / stroke - LANDS) + 1
        if (landed > job.strokes) {
          job.strokes = landed
          let chip = n
            ? chipOf(n.lode.look)
            : isStation(trade)
            ? STATIONS[trade].chip
            : 0xffffff
          events.push({ type: 'stroke', eid, trade, at, chip })
        }
        if (now >= job.until) {
          job = null
          if (n) events.push(gather(n, me, now, mine, directive))
          else if (piece) events.push(upgrade(piece, me, now, at, f))
          else if (recipe) {
            events.push(make(recipe, me, now, at, f, mine[trade].lvl))
          }
        } else {
          doing = {
            trade,
            at,
            node: n,
            recipe,
            piece,
            k: into / (job.until - job.from),
            swing: trade != 'fish'
              ? (into % stroke) / stroke
              : into < CAST
              ? into / CAST
              : -1,
          }
        }
      }
      return { nodes, near, bench, board, doing, trades: mine, events }
    },
  }
}
