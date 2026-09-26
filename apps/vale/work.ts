// A hero's work at the nodes of the level they are in (gather.ts): which node
// is near enough to work, the work under way, and what it yields. The frame
// (play.ts) moves the hero; this reads where they stand and what they asked
// for, and when a node's work is done writes the item it gave, wearing the
// `gathered` row that spends the node for everyone until it grows back. The
// work stops when the hero walks off, strikes, rolls, jumps or faints, or
// someone else gathers the node first.
import {
  effort,
  haulOf,
  least,
  type Lode,
  LODES,
  nodesOf,
  type Trade,
  TRADES,
  type Trades,
  tradesOf,
  tradeXp,
} from './gather.ts'
import { type Bundle, comp, type Net, num, str } from './net.ts'
import type { Frame, Vec3 } from './play.ts'
import { fallOf } from './rules.ts'
import { groundAt, type Vale, WATER } from './terrain.ts'

/** A node as this frame sees it: which, where it stands on the ground or the
 * water, whether it is spent and for how many ms more, how far from the hero
 * it is, middle to middle, and whether the hero's trade reaches its tier. */
export type Seen = {
  eid: string
  kind: string
  lode: Lode
  at: Vec3
  spent: boolean
  back: number
  near: number
  able: boolean
}

/** What happened at the work this frame, for the eyes and ears: a stroke
 * landing (a chop, a clink, a rustle, a splash), a node gathered, a trade
 * grown a level, or something to tell the player. */
export type Work =
  | { type: 'stroke'; eid: string; trade: Trade; at: Vec3; kind: string }
  | {
    type: 'gathered'
    eid: string
    item: string
    n: number
    trade: Trade
    xp: number
    at: Vec3
  }
  | { type: 'trade'; trade: Trade; lvl: number }
  | { type: 'say'; text: string }

/** The work as this frame has it: the level's nodes, the one near enough to
 * work, the one being worked and how far through, 0 to 1, with how far
 * through the stroke it is (the hero's swing, or -1 while a line waits in the
 * water), the hero's trades, and what happened. */
export type Job = {
  nodes: Seen[]
  near: Seen | null
  doing: { node: Seen; k: number; swing: number } | null
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
}
let LANDS = 0.33
let CAST = 520
// A hero this far from where the work began, in metres, has walked off.
let STRAY = 0.5

let secs = (ms: number) => {
  let s = Math.ceil(ms / 1000)
  return s < 60
    ? `${s}s`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A hero's gathering over one store. */
export let gathering = (net: Net) => {
  let job: {
    eid: string
    from: number
    until: number
    x: number
    z: number
    strokes: number
  } | null = null

  // My trades, worked out again only when my items changed; and the last
  // ones, to see a level gained.
  let itemsWas: Bundle[] | null = null
  let trades = tradesOf([])
  let was: Trades | null = null
  let tradesOfMine = () => {
    let items = net.mine('item')
    if (items == itemsWas) return trades
    itemsWas = items
    trades = tradesOf(items.flatMap((b) => {
      let g = comp(b, 'gathered')
      return g.kind == null ? [] : [str(g.kind)]
    }))
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

  return {
    /** A frame of work: `want` is the player asking to gather, `stop` their
     * doing something else. */
    tick: (v: Vale, f: Frame, want: boolean, stop: boolean): Job => {
      let me = net.hero
      let now = f.now
      let events: Work[] = []
      let mine = tradesOfMine()
      if (was) {
        for (let t of Object.keys(mine) as Trade[]) {
          if (mine[t].lvl > was[t].lvl) {
            events.push({ type: 'trade', trade: t, lvl: mine[t].lvl })
          }
        }
      }
      was = mine
      let rows = gatherings()
      let nodes = nodesOf(v).map((n): Seen => {
        let lode = LODES[n.lode]
        let respawn = TRADES[lode.trade].respawn * 1000
        let fall = fallOf(rows.get(n.eid) ?? [], respawn / 1000, now)
        let y = lode.trade == 'fish' ? WATER : groundAt(v, n.x, n.z)
        return {
          eid: n.eid,
          kind: n.lode,
          lode,
          at: [n.x, y, n.z],
          spent: fall.down,
          back: fall.down ? fall.fell + respawn - now : 0,
          near: Math.hypot(n.x - f.body.x, n.z - f.body.z),
          able: mine[lode.trade].lvl >= least(lode.tier),
        }
      })
      let near = nodes
        .filter((n) => n.near <= TRADES[n.lode.trade].reach)
        .sort((a, b) => a.near - b.near)[0] ?? null

      // Work stops when the hero does something else, or the node is gone.
      if (job) {
        let eid = job.eid
        let n = nodes.find((n) => n.eid == eid)
        let strayed = Math.hypot(f.body.x - job.x, f.body.z - job.z) > STRAY
        if (!n || stop || f.down || strayed || f.level != v.level.id) {
          job = null
        } else if (n.spent) {
          job = null
          events.push({
            type: 'say',
            text: `Someone got to the ${n.lode.name.toLowerCase()} first.`,
          })
        }
      }

      // Asked to gather: the nearest node, if it is whole and the hero's
      // trade reaches it.
      if (want && !job && !f.down && me) {
        if (!near) {
          events.push({ type: 'say', text: 'Nothing to gather here.' })
        } else if (near.spent) {
          events.push({
            type: 'say',
            text: `${near.lode.name}: spent. It grows back in ${
              secs(near.back)
            }.`,
          })
        } else if (!near.able) {
          let t = TRADES[near.lode.trade]
          events.push({
            type: 'say',
            text: `${near.lode.name} asks ${t.name} ${
              least(near.lode.tier)
            }. Yours is ${mine[near.lode.trade].lvl}.`,
          })
        } else {
          job = {
            eid: near.eid,
            from: now,
            until: now + effort(near.lode, mine[near.lode.trade].lvl),
            x: f.body.x,
            z: f.body.z,
            strokes: 0,
          }
        }
      }

      // The work under way: a stroke landing, and at the end what it gave.
      let doing: Job['doing'] = null
      if (job && me) {
        let eid = job.eid
        let n = nodes.find((n) => n.eid == eid)!
        let trade = n.lode.trade
        let stroke = STROKE[trade]
        let into = now - job.from
        let landed = Math.floor(into / stroke - LANDS) + 1
        if (landed > job.strokes) {
          job.strokes = landed
          events.push({
            type: 'stroke',
            eid: n.eid,
            trade,
            at: n.at,
            kind: n.kind,
          })
        }
        if (now >= job.until) {
          let lvl = mine[trade].lvl
          let count = haulOf(n.eid, now, me, n.kind, lvl)
          net.keep({
            entity: { eid: crypto.randomUUID() },
            item: { kind: n.lode.gives, n: count, owner: me, at: now },
            gathered: { node: n.eid, kind: n.kind, at: now },
          })
          events.push({
            type: 'gathered',
            eid: n.eid,
            item: n.lode.gives,
            n: count,
            trade,
            xp: tradeXp(n.lode.tier),
            at: n.at,
          })
          job = null
        } else {
          doing = {
            node: n,
            k: into / (job.until - job.from),
            swing: trade != 'fish'
              ? (into % stroke) / stroke
              : into < CAST
              ? into / CAST
              : -1,
          }
        }
      }
      return { nodes, near, doing, trades: mine, events }
    },
  }
}
