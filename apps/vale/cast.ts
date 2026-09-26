// Who is on stage: a figure for every player and creature the frame knows,
// the Elder by the fire, loot on the ground, and the plates over heads.
// A figure is made when someone arrives and dropped when they go; each frame
// moves it to where the frame says it is, smoothing what arrives in steps (a
// peer's pose comes ten times a second, not sixty).
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { type Act, beast, elder, type Figure, hero } from './figures.ts'
import type { overlay } from './fx.ts'
import { cuboid, out, type Vec } from './mesh.ts'
import type { Frame } from './play.ts'
import { BEASTS, ITEMS } from './rules.ts'
import { geometry, soft } from './soft.ts'
import { groundAt, type Vale } from './terrain.ts'

type Look = { tint: string; hair: string; skin: string }

type Actor = {
  fig: Figure
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  swingAt: number
  swings: number
  hp: number
  hurtAt: number
  seen: boolean
  look: string
}

// Loot, each kind a few soft boxes.
let LOOT: Record<string, [Vec, Vec, number][]> = {
  jelly: [[[-0.15, 0, -0.15], [0.3, 0.26, 0.3], 0x86d65c], [
    [-0.1, 0.26, -0.1],
    [0.2, 0.06, 0.2],
    0x5aa83e,
  ]],
  tusk: [[[-0.05, 0, -0.14], [0.1, 0.1, 0.28], 0xf2ead6], [[-0.05, 0.08, 0.1], [
    0.1,
    0.18,
    0.08,
  ], 0xf2ead6]],
  shard: [[[-0.08, 0, -0.08], [0.16, 0.42, 0.16], 0x6fb8f0], [
    [0.06, 0, -0.02],
    [0.1, 0.26, 0.1],
    0x9ad4ff,
  ]],
  crown: [
    [[-0.18, 0, -0.18], [0.36, 0.1, 0.36], 0xf2c14e],
    [[-0.18, 0.1, -0.18], [0.07, 0.12, 0.07], 0xf2c14e],
    [[0.11, 0.1, 0.11], [0.07, 0.12, 0.07], 0xf2c14e],
    [[-0.035, 0.1, 0.11], [0.07, 0.16, 0.07], 0xe0573f],
  ],
  coin: [[[-0.13, 0, -0.13], [0.26, 0.06, 0.26], 0xf2c14e], [
    [-0.1, 0.06, -0.1],
    [0.2, 0.05, 0.2],
    0xe8b43a,
  ]],
  tonic: [
    [[-0.1, 0, -0.1], [0.2, 0.24, 0.2], 0xc0406a],
    [[-0.05, 0.24, -0.05], [0.1, 0.1, 0.1], 0xe8e0d0],
    [[-0.04, 0.34, -0.04], [0.08, 0.05, 0.08], 0x8a5a3c],
  ],
  blade2: [[[-0.02, 0, -0.02], [0.04, 0.5, 0.04], 0xdfe6ee], [
    [-0.1, 0.1, -0.03],
    [0.2, 0.04, 0.06],
    0xe2b64c,
  ]],
  blade3: [[[-0.03, 0, -0.03], [0.06, 0.56, 0.06], 0xbfe2ff], [
    [-0.12, 0.12, -0.04],
    [0.24, 0.05, 0.08],
    0x8fd46a,
  ]],
}

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let bar = (k: number, cls = '') =>
  `<span class="Plate_Bar ${cls}"><i style="--k:${
    Math.max(0, Math.min(1, k)).toFixed(3)
  }"></i></span>`

/** The stage over one scene. */
export let cast = (
  scene: THREE.Scene,
  v: Vale,
  plates: ReturnType<typeof overlay>,
) => {
  let actors = new Map<string, Actor>()
  let lootMat = soft({ speckle: 0.05 })
  let lootGeo = new Map<string, THREE.BufferGeometry>()
  let loot = new Map<string, THREE.Mesh>()
  let ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 40),
    new THREE.MeshBasicMaterial({
      color: 0xff7a4a,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  scene.add(ring)
  let at = new THREE.Vector3()

  let actor = (key: string, make: () => Figure, look = ''): Actor => {
    let a = actors.get(key)
    if (a && a.look != look) {
      scene.remove(a.fig.root)
      a = undefined
    }
    if (!a) {
      let fig = make()
      scene.add(fig.root)
      a = {
        fig,
        x: NaN,
        y: 0,
        z: 0,
        yaw: 0,
        speed: 0,
        swingAt: -1e9,
        swings: -1,
        hp: -1,
        hurtAt: -1e9,
        seen: true,
        look,
      }
      actors.set(key, a)
    }
    a.seen = true
    return a
  }

  // Move an actor toward where it is said to be: at once the first time, and
  // after that smoothly, fast enough that a step of a tenth of a second is
  // never seen as a step.
  let glide = (
    a: Actor,
    x: number,
    y: number,
    z: number,
    yaw: number,
    dt: number,
    k = 14,
  ) => {
    if (Number.isNaN(a.x)) [a.x, a.y, a.z, a.yaw] = [x, y, z, yaw]
    let f = 1 - Math.exp(-dt * k)
    let px = a.x, pz = a.z
    a.x += (x - a.x) * f
    a.z += (z - a.z) * f
    a.y += (y - a.y) * (1 - Math.exp(-dt * 20))
    a.yaw += Math.atan2(Math.sin(yaw - a.yaw), Math.cos(yaw - a.yaw)) *
      (1 - Math.exp(-dt * 12))
    a.speed += (Math.hypot(a.x - px, a.z - pz) / Math.max(dt, 1e-3) - a.speed) *
      0.25
    a.fig.root.position.set(a.x, a.y, a.z)
    a.fig.root.rotation.y = a.yaw
  }

  let play = (a: Actor, act: Partial<Act>, t: number, dt: number) =>
    a.fig.animate({
      speed: a.speed,
      air: false,
      swing: -1,
      hurt: 0,
      down: false,
      t,
      ...act,
    }, dt)

  let head = (a: Actor, up = 0) => at.set(a.x, a.y + a.fig.height + up, a.z)

  return {
    tick: (f: Frame, me: string, look: Look, dt: number) => {
      let t = performance.now() / 1000
      let now = performance.now()
      for (let a of actors.values()) a.seen = false

      // Me.
      let mine = actor(me, () => hero(look), JSON.stringify(look))
      glide(mine, f.body.x, f.body.y, f.body.z, f.body.yaw, dt, 30)
      mine.speed = f.body.speed
      let hurt = f.events.some((e) => e.type == 'hurt')
      if (hurt) mine.hurtAt = now
      play(
        mine,
        {
          air: f.body.gait == 'jump',
          swing: f.swing,
          hurt: Math.max(0, 1 - (now - mine.hurtAt) / 250),
          down: f.pose.gait == 'down',
        },
        t,
        dt,
      )

      // The others.
      for (let o of f.others) {
        let p = o.pose
        let a = actor(o.eid, () => hero(o.look), JSON.stringify(o.look))
        glide(a, p.x ?? 0, p.y ?? 0, p.z ?? 0, p.yaw ?? 0, dt, 9)
        if (a.swings >= 0 && (p.swing ?? 0) > a.swings) a.swingAt = now
        a.swings = p.swing ?? 0
        if (a.hp >= 0 && (p.hp ?? 0) < a.hp) a.hurtAt = now
        a.hp = p.hp ?? 0
        let down = p.gait == 'down'
        play(
          a,
          {
            air: p.gait == 'jump',
            swing: now - a.swingAt < 520 ? (now - a.swingAt) / 520 : -1,
            hurt: Math.max(0, 1 - (now - a.hurtAt) / 250),
            down,
          },
          t,
          dt,
        )
        let life = (p.hp ?? 0) / Math.max(1, p.max ?? 1)
        plates.plate(
          o.eid,
          head(a, 0.25),
          `<span><b>${esc(o.name)}</b> <em>${p.lvl ?? 1}</em></span>${
            life < 0.999 ? bar(life, 'Plate_Bar-friend') : ''
          }`,
          'Plate Plate-friend',
        )
      }

      // The creatures.
      ring.visible = false
      for (let m of f.mobs) {
        if (m.near > 75) continue
        let b = BEASTS[m.kind]
        let a = actor(m.eid, () => beast(m.kind))
        let gone = m.down ? (f.now - m.since) / 1000 : 0
        // A fallen creature lies a moment, sinks into the moss, and is gone
        // until it wakes.
        let sink = Math.max(0, gone - 1.4) * 0.9
        a.fig.root.visible = !m.down || gone < 3
        glide(
          a,
          m.body.x,
          m.body.y - sink * b.size,
          m.body.z,
          m.body.yaw,
          dt,
          16,
        )
        let bite = m.body.bite ? f.now - m.body.bite : 1e9
        play(
          a,
          {
            swing: bite < 700 ? bite / 700 : -1,
            hurt: Math.max(0, 1 - m.hurt / 220),
            down: m.down,
            air: false,
          },
          t,
          dt,
        )
        let foe = f.foe?.eid == m.eid
        if (foe) {
          ring.visible = true
          ring.position.set(a.x, groundAt(v, a.x, a.z) + 0.06, a.z)
          ring.scale.setScalar(0.55 + b.size * 0.6)
        }
        if (!m.down && (foe || m.near < 12 || m.hurt < 4000)) {
          plates.plate(
            m.eid,
            head(a, 0.15),
            `<span><b>${esc(b.name)}</b> <em>${b.lvl}</em></span>${
              bar(m.hp / m.most, 'Plate_Bar-foe')
            }`,
            `Plate Plate-foe${b.lvl >= 8 ? ' Plate-boss' : ''}`,
          )
        }
      }

      // The Elder, with a mark over their head when they have something to say.
      if (f.elder) {
        let e = f.elder
        let a = actor(e.eid, elder)
        let d = Math.hypot(f.body.x - e.x, f.body.z - e.z)
        let yaw = d < 8 ? Math.atan2(f.body.x - e.x, f.body.z - e.z) : 0.6
        glide(a, e.x, groundAt(v, e.x, e.z), e.z, yaw, dt, 3)
        a.speed = 0
        play(a, {}, t, dt)
        let next = f.sheet.quests.find((q) => q.state != 'done')
        let mark = !next
          ? ''
          : next.state == 'open'
          ? '<span class=Mark>!</span>'
          : next.have >= next.quest.count
          ? '<span class="Mark Mark-ready">?</span>'
          : ''
        plates.plate(
          e.eid,
          head(a, 0.2),
          `${mark}<b>${esc(e.name)}</b>`,
          'Plate Plate-npc',
        )
      }

      // Loot.
      let lying = new Set<string>()
      for (let d of f.drops) {
        lying.add(d.eid)
        let mesh = loot.get(d.eid)
        if (!mesh) {
          let g = lootGeo.get(d.kind)
          if (!g) {
            let o = out()
            for (let [min, size, hex] of LOOT[d.kind] ?? LOOT.coin) {
              cuboid(o, min, size, hex, 0.05, 0.02)
            }
            g = geometry(o)
            lootGeo.set(d.kind, g)
          }
          mesh = new THREE.Mesh(g, lootMat)
          mesh.castShadow = true
          scene.add(mesh)
          loot.set(d.eid, mesh)
        }
        let bob = Math.sin(t * 3 + d.at) * 0.08
        mesh.position.set(d.x, d.y + 0.25 + bob, d.z)
        mesh.rotation.y = t * 1.8 + d.at
        mesh.scale.setScalar(1.6)
      }
      for (let [eid, mesh] of loot) {
        if (lying.has(eid)) continue
        scene.remove(mesh)
        loot.delete(eid)
      }

      for (let [key, a] of actors) {
        if (a.seen) continue
        scene.remove(a.fig.root)
        actors.delete(key)
      }
    },
    /** where someone's head is, for what floats up from them */
    headOf: (eid: string): THREE.Vector3 | null => {
      let a = actors.get(eid)
      return a ? new THREE.Vector3(a.x, a.y + a.fig.height, a.z) : null
    },
  }
}

export let lootName = (kind: string) => ITEMS[kind]?.name ?? kind
