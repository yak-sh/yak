// A frame of the game. The page's graph holds what is true (who is where, how
// hurt, what has fallen, what each player carries); this reads it, decides
// what happens next, and hands back the frame's changes as one list for one
// `mutate`, with what happened, for the eyes and ears (`Event`).
//
// Who decides what:
//   - A player's own page moves them, swings their blade, and takes the bites
//     aimed at them. Their pose carries the outcome to everyone.
//   - Every page moves every creature near its player, from the same rules and
//     the same poses, so the pages agree near enough with no server deciding.
//   - A creature's health is its most, less what the poses say was dealt it in
//     this life (rules.ts `hpOf`). A fall is a `slain` row, one per player who
//     helped, and the loot it leaves is each player's own.
import { type Bundle, comp, type Net, num, str } from './net.ts'
import type { Intent } from './input.ts'
import {
  BEASTS,
  blow,
  edgeOf,
  fallOf,
  type Held,
  hpOf,
  hunter,
  ITEMS,
  levelOf,
  lootOf,
  maxHp,
  type Pose,
  type Quest,
  questsOf,
  type Slain,
  xpOf,
} from './rules.ts'
import { type Body, HEARTH, prowl, rest, SAFE, turn, walk } from './sim.ts'
import { groundAt, type Vale } from './terrain.ts'

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
  | { type: 'bite'; eid: string }
  | { type: 'hurt'; dmg: number; at: Vec3 }
  | { type: 'fall'; eid: string; beast: string; at: Vec3 }
  | { type: 'loot'; item: string; n: number; at: Vec3 }
  | { type: 'xp'; n: number; at: Vec3 }
  | { type: 'level'; lvl: number }
  | { type: 'heal'; n: number; at: Vec3 }
  | { type: 'faint' }
  | { type: 'rise' }
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
  near: number
}

/** Another player as this frame sees them. */
export type Other = {
  eid: string
  name: string
  look: { tint: string; hair: string; skin: string }
  pose: Pose
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

export type Frame = {
  body: Body
  pose: Pose
  sheet: Sheet
  mobs: Mob[]
  others: Other[]
  drops: Drop[]
  elder:
    | { eid: string; name: string; x: number; z: number; greets: string }
    | null
  /** the Elder is close enough to talk to */
  talk: boolean
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
let POSE = 100
let LEASH = 26
let PICK = 1.3
let PULL = 3.8
let DROP_LIFE = 120_000

let bodyOf = (b: Bundle | undefined): Body | null => {
  let c = comp(b, 'body')
  if (c.x == null) return null
  return {
    x: num(c.x),
    y: num(c.y),
    z: num(c.z),
    vy: num(c.vy),
    yaw: num(c.yaw),
    speed: num(c.speed),
    gait: str(c.gait, 'idle'),
    hunts: str(c.hunts),
    bite: num(c.bite),
  }
}

let poseOf = (b: Bundle | undefined): Pose | null => {
  let c = comp(b, 'pose')
  if (c.x == null) return null
  return {
    x: num(c.x),
    y: num(c.y),
    z: num(c.z),
    yaw: num(c.yaw),
    gait: str(c.gait, 'idle'),
    swing: num(c.swing),
    hp: num(c.hp, 1),
    max: num(c.max, 1),
    lvl: num(c.lvl, 1),
    foe: str(c.foe),
    dmg: num(c.dmg),
    life: num(c.life),
  }
}

let dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

let round = (v: number, k = 100) => Math.round(v * k) / k

let questsFrom = (rows: Bundle[]): Quest[] =>
  rows.map((b) => {
    let q = comp(b, 'quest'), d = comp(b, 'doc')
    return {
      eid: b.entity.eid,
      step: num(q.step),
      goal: str(q.goal),
      target: str(q.target),
      count: num(q.count, 1),
      xp: num(q.xp),
      gift: str(q.gift) || undefined,
      title: str(d.title),
      body: str(d.body),
    }
  })

/** The game over one vale and one store. */
export let game = (v: Vale, net: Net) => {
  let c = net.client
  let drops = c.watch('.drop', { remote: false })
  // What I relay, as this page keeps it between sends: my health, my
  // blows, my fight. The graph gets it ten times a second.
  let mine: Pose | null = null
  let swingAt = -1e9
  let struck = true
  let downAt = 0
  let hurtAt = 0
  let poseAt = 0
  let sent = ''
  let lvlWas = 0
  let shares = new Set<string>()
  let sinking = new Map<string, number>()
  let hpWas = new Map<string, number>()
  let hitAt = new Map<string, number>()
  let wasDown = new Set<string>()

  let spawn = (): Body => {
    let x = HEARTH[0] - 1.5 + Math.random() * 3,
      z = HEARTH[1] + 3.5 + Math.random() * 1.5
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

  // The sheet, worked out again only when one of its rows changed.
  let sheetKey: unknown[] = []
  let sheet: Sheet | null = null
  let sheetOf = (): Sheet => {
    let slain = net.mine('slain'), items = net.mine('item')
    let used = net.mine('used'), journal = net.mine('journal')
    let quests = net.watches.quests.value
    let name = str(comp(c.ent(net.hero ?? ''), 'player').name, 'Wanderer')
    let key = [slain, items, used, journal, quests, name]
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
    let qs = questsFrom(quests)
    let xp = xpOf(kills, qs, entries)
    let lvl = levelOf(xp)
    sheet = {
      name,
      xp,
      lvl,
      max: maxHp(lvl),
      edge: edgeOf(bag),
      bag,
      quests: questsOf(qs, entries, kills, bag),
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

  return {
    /** take up the Elder's next quest */
    accept: (q: Quest) => {
      let me = net.hero
      if (!me) return
      net.keep({
        entity: { eid: crypto.randomUUID() },
        journal: { player: me, quest: q.eid, step: 'taken', at: net.now() },
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
        journal: { player: me, quest: q.eid, step: 'done', at: now },
      })
      if (q.gift) keepItem(me, q.gift, 1, now)
      let gift = q.gift
        ? ` Elder Wren gives you ${ITEMS[q.gift]?.name ?? q.gift}.`
        : ''
      return [{ type: 'say', text: `${q.title}: done! +${q.xp} xp.${gift}` }]
    },

    frame: (intent: Intent, look: number, dt: number): Frame | null => {
      let me = net.hero
      if (!me) return null
      let now = net.now()
      let events: Event[] = []
      let change: Bundle[] = []
      let s = sheetOf()
      let row = c.ent(me)
      let body = bodyOf(row) ?? spawn()
      mine ??= poseOf(row) ?? { hp: s.max, swing: 0, foe: '', dmg: 0, life: 0 }
      let pose = mine
      let hp = pose.hp ?? s.max
      if (lvlWas && s.lvl > lvlWas) {
        events.push({ type: 'level', lvl: s.lvl })
        hp = s.max
      }
      lvlWas = s.lvl
      let down = pose.gait == 'down'
      let at = (
        b: { x: number; y: number; z: number },
        up = 1,
      ): Vec3 => [b.x, b.y + up, b.z]

      // The hero: up again at the fire after fainting, or moving as asked.
      if (down) {
        if (now - downAt > DOWN) {
          body = spawn()
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

      // Everyone's pose: mine as it stands, the others' as relayed.
      let others: Other[] = []
      let poses: [string, Pose][] = []
      for (let b of net.watches.players.value) {
        let eid = b.entity.eid
        if (eid == me) continue
        let p = poseOf(c.ent(eid))
        if (!p) continue
        let pl = comp(c.ent(eid), 'player')
        others.push({
          eid,
          name: str(pl.name, 'Wanderer'),
          look: {
            tint: str(pl.tint, '#c95f4a'),
            hair: str(pl.hair, '#5a3a26'),
            skin: str(pl.skin, '#e7b996'),
          },
          pose: p,
        })
        poses.push([eid, p])
      }
      poses.push([me, pose])
      let alive = (p: Pose) => p.gait != 'down'
      let spot = (eid: string): { x: number; z: number } | null => {
        if (eid == me) return { x: body.x, z: body.z }
        let p = others.find((o) => o.eid == eid)?.pose
        return p ? { x: p.x ?? 0, z: p.z ?? 0 } : null
      }
      let falls = fallsBy()

      // The creatures.
      let mobs: Mob[] = []
      for (let b of net.watches.creatures.value) {
        let eid = b.entity.eid
        let cr = comp(c.ent(eid), 'creature')
        let kind = str(cr.kind, 'slime'), beast = BEASTS[kind] ?? BEASTS.slime
        let home: [number, number] = [num(cr.x), num(cr.z)]
        let roam = num(cr.roam, 5)
        let seed = [...eid].reduce((h, ch) =>
          (h * 31 + ch.charCodeAt(0)) | 0, 7) >>> 0
        let f = fallOf(falls.get(eid) ?? [], beast.respawn, now)
        let life = f.fell
        let hpNow = f.down
          ? 0
          : hpOf(eid, beast.hp, life, poses.map(([, p]) => p))
        let wasHp = hpWas.get(eid) ?? beast.hp
        hpWas.set(eid, hpNow)
        let fallen = f.down || hpNow <= 0
        if (fallen && !sinking.has(eid)) sinking.set(eid, f.down ? f.fell : now)
        if (!fallen) sinking.delete(eid)
        let near = Math.hypot(home[0] - body.x, home[1] - body.z)
        let mb = bodyOf(c.ent(eid))
        // Out of sight, or just up again: where its wandering has it now.
        if (!mb || (wasDown.has(eid) && !fallen) || near > 90) {
          mb = rest(v, home, roam, seed, now)
        }
        if (fallen) wasDown.add(eid)
        else wasDown.delete(eid)
        if (!fallen && hpNow < wasHp && pose.foe != eid) {
          events.push({
            type: 'struck',
            eid,
            at: at(mb, beast.size + 0.3),
            dmg: wasHp - hpNow,
          })
          hitAt.set(eid, now)
        }
        if (near <= 90 && !fallen) {
          // Whom it is after: whoever is hurting it most, while they stay
          // near its home; else, if it is the kind that minds, whoever comes
          // close.
          let quarry = ''
          let h = hunter(eid, life, poses)
          let hs = h && spot(h)
          let hpose = h && poses.find(([w]) => w == h)?.[1]
          if (
            h && hs && hpose && alive(hpose) &&
            dist(hs, { x: home[0], z: home[1] }) < roam + LEASH
          ) {
            quarry = h
          } else if (beast.aggro) {
            let best = beast.aggro * (mb.hunts ? 1.8 : 1)
            for (let [w, p] of poses) {
              let ws = spot(w)
              if (!ws || !alive(p)) continue
              if (Math.hypot(ws.x - HEARTH[0], ws.z - HEARTH[1]) < SAFE) {
                continue
              }
              if (dist(ws, { x: home[0], z: home[1] }) > roam + LEASH) continue
              let d = dist(ws, mb)
              if (d < best) [best, quarry] = [d, w]
            }
          }
          let qs = quarry ? spot(quarry) : null
          mb = {
            ...prowl(v, mb, beast, home, roam, seed, now, dt, qs),
            hunts: quarry,
            bite: mb.bite ?? 0,
          }
          if (
            qs && dist(qs, mb) <= beast.reach + 0.4 &&
            now - (mb.bite ?? 0) > 1500
          ) {
            mb.bite = now
            events.push({ type: 'bite', eid })
            if (quarry == me && !down) {
              let dmg = Math.round(beast.dmg * (0.85 + Math.random() * 0.3))
              hp -= dmg
              hurtAt = now
              events.push({ type: 'hurt', dmg, at: at(body, 2) })
            }
          }
          change.push({ entity: { eid }, body: { ...mb } })
        }
        mobs.push({
          eid,
          kind,
          body: mb,
          hp: hpNow,
          most: beast.hp,
          down: fallen,
          since: sinking.get(eid) ?? 0,
          hurt: now - (hitAt.get(eid) ?? -1e9),
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
            drop: { kind: l.kind, n: l.n, x, y: groundAt(v, x, z), z, at: now },
          })
        })
      }

      // My blade.
      if (!down && intent.strike && now - swingAt > SWING) {
        swingAt = now
        struck = false
        pose.swing = (pose.swing ?? 0) + 1
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
          if (pose.foe != m.eid || pose.life != life) {
            Object.assign(pose, { foe: m.eid, life, dmg: 0 })
          }
          let { dmg, great } = blow(s.lvl, s.edge, Math.random())
          pose.dmg = (pose.dmg ?? 0) + dmg
          m.hp = hpOf(m.eid, beast.hp, life, poses.map(([, p]) => p))
          hpWas.set(m.eid, m.hp)
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
          // Knocked back a little.
          let k = 0.45 / Math.max(0.3, beast.size)
          let a = Math.atan2(m.body.x - body.x, m.body.z - body.z)
          m.body = {
            ...m.body,
            x: m.body.x + Math.sin(a) * k,
            z: m.body.z + Math.cos(a) * k,
          }
          change.push({ entity: { eid: m.eid }, body: { ...m.body } })
          if (m.hp <= 0) {
            m.down = true
            m.since = now
            sinking.set(m.eid, now)
            fell(m, life, now)
          }
        }
      }

      // Someone else's blow felled what I was fighting: my share.
      if (pose.foe && (pose.dmg ?? 0) > 0) {
        let m = mobs.find((m) => m.eid == pose.foe)
        if (m) {
          let f = fallOf(falls.get(m.eid) ?? [], BEASTS[m.kind].respawn, now)
          if (f.down && f.fell > (pose.life ?? 0)) {
            fell(m, pose.life ?? 0, f.fell)
          } else if (m.down && f.fell == pose.life) fell(m, pose.life ?? 0, now)
        }
      }

      // A tonic.
      if (intent.drink && !down) {
        let tonic = s.bag.find((h) => h.kind == 'tonic')
        if (!tonic) {
          events.push({
            type: 'say',
            text: 'No tonic left. The Elder brews them.',
          })
        } else if (hp >= s.max) {
          events.push({ type: 'say', text: 'You feel fine already.' })
        } else {
          spend(me, tonic.eid, now)
          let n = Math.min(s.max - hp, ITEMS.tonic.heals ?? 60)
          hp += n
          events.push({ type: 'heal', n, at: at(body, 2) })
        }
      }

      // Mending, when nothing has bitten for a while.
      if (!down && now - hurtAt > 6000 && hp < s.max) {
        hp = Math.min(s.max, hp + s.max * 0.025 * dt)
      }
      if (!down && hp <= 0) {
        hp = 0
        down = true
        downAt = now
        events.push({ type: 'faint' })
      }

      // Loot on the ground: drawn to me when near, mine when touched.
      let lying: Drop[] = []
      for (let b of drops.value) {
        let d = comp(c.ent(b.entity.eid), 'drop')
        if (d.kind == null) continue
        let drop: Drop = {
          eid: b.entity.eid,
          kind: str(d.kind),
          n: num(d.n, 1),
          x: num(d.x),
          y: num(d.y),
          z: num(d.z),
          at: num(d.at),
        }
        let dd = dist(drop, body)
        if (now - drop.at > DROP_LIFE) {
          change.push({ entity: { eid: drop.eid }, drop: null })
        } else if (!down && dd < PICK && now - drop.at > 350) {
          change.push({ entity: { eid: drop.eid }, drop: null })
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
              drop: { x: drop.x, y: drop.y, z: drop.z },
            })
          }
          lying.push(drop)
        }
      }

      // The Elder.
      let npc = net.watches.npcs.value[0]
      let n = comp(npc && c.ent(npc.entity.eid), 'npc')
      let elder = npc
        ? {
          eid: npc.entity.eid,
          name: str(n.name, 'Elder'),
          x: num(n.x),
          z: num(n.z),
          greets: str(n.greets),
        }
        : null

      // What I am, for the others: sent ten times a second when it changed.
      Object.assign(pose, {
        x: round(body.x),
        y: round(body.y),
        z: round(body.z),
        yaw: round(body.yaw),
        gait: down ? 'down' : body.gait,
        hp: Math.round(Math.max(0, hp)),
        max: s.max,
        lvl: s.lvl,
      })
      let me_ = { entity: { eid: me }, body: { ...body } }
      let now_ = performance.now()
      let said = JSON.stringify(pose)
      if (said != sent && now_ - poseAt >= POSE) {
        poseAt = now_
        sent = said
        change.push({ ...me_, pose: { ...pose } })
      } else change.push(me_)
      net.move(change)
      net.tick()

      let foe =
        mobs.find((m) =>
          m.eid == pose.foe && !m.down && now - (hitAt.get(m.eid) ?? 0) < 8000
        ) ?? null
      return {
        body,
        pose,
        sheet: s,
        mobs,
        others,
        drops: lying,
        elder,
        talk: !!elder && !down &&
          Math.hypot(elder.x - body.x, elder.z - body.z) < 3.6,
        foe,
        swing: now - swingAt < SWING ? (now - swingAt) / SWING : -1,
        events,
        now,
      }
    },
  }
}
