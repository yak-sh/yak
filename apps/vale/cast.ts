// Who is on stage: a figure for every player and creature the frame knows,
// the people who give quests, loot on the ground, the plates over heads and
// over signposts, and under each creature on my trail a red ring round the
// ground its bite takes. As a bite winds up, a red disc grows from its middle
// and fills the ring the moment the bite lands. Red means a bite and nothing
// else: the creature I have targeted wears a pale mark at its feet instead.
// A figure is made when someone arrives and dropped when they go; each frame
// moves it to where the frame says it is, smoothing what arrives in steps (a
// peer's position comes when their page sends it, not on this page's beat).
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { BEASTS } from './beasts.ts'
import { type Act, beast, type Figure, hero, person } from './figures.ts'
import type { overlay } from './fx.ts'
import { ITEMS } from './items.ts'
import { LEVELS } from './levels.ts'
import { cuboid, out } from './mesh.ts'
import type { Frame } from './play.ts'
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
  /** metres a second the way it faces, back when negative */
  ahead: number
  /** which way a roll tumbles it: 1 forward, -1 back, 0 not yet known */
  tumble: number
  swingAt: number
  swings: number
  hp: number
  hurtAt: number
  seen: boolean
  look: string
}

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let bar = (k: number, cls = '') =>
  `<span class="Plate_Bar ${cls}"><i style="--k:${
    Math.max(0, Math.min(1, k)).toFixed(3)
  }"></i></span>`

/** The stage over one level's scene. */
export let cast = (
  scene: THREE.Scene,
  v: Vale,
  plates: ReturnType<typeof overlay>,
) => {
  let actors = new Map<string, Actor>()
  let lootMat = soft({ speckle: 0.05 })
  let lootGeo = new Map<string, THREE.BufferGeometry>()
  let loot = new Map<string, THREE.Mesh>()
  // The creature I have targeted: four pale arcs round its feet, turning
  // slowly, drawn over any red beneath them. A broken ring the colour of
  // paper, so it reads as a selection and never as a second bite.
  let mark = new THREE.Group()
  let arc = new THREE.RingGeometry(0.84, 1, 12, 1, 0, Math.PI / 3)
  let pale = new THREE.MeshBasicMaterial({
    color: 0xfbf7ea,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  for (let i = 0; i < 4; i++) {
    let m = new THREE.Mesh(arc, pale)
    m.rotation.z = (i * Math.PI) / 2
    m.renderOrder = 1
    mark.add(m)
  }
  mark.rotation.x = -Math.PI / 2
  mark.visible = false
  scene.add(mark)
  // A creature on my trail: the ground its bite takes (`zone`, a thin ring
  // whose outer edge is its reach) and the bite winding up (`fill`, a disc).
  let red = (opacity: number) =>
    new THREE.MeshBasicMaterial({
      color: 0xff3b2f,
      transparent: true,
      opacity,
      depthWrite: false,
    })
  let thin = new THREE.RingGeometry(0.9, 1, 56)
  let disc = new THREE.CircleGeometry(1, 56)
  let edge = red(0.75)
  let laid = <M extends THREE.Material>(g: THREE.BufferGeometry, m: M) => {
    let r = new THREE.Mesh(g, m)
    r.rotation.x = -Math.PI / 2
    r.visible = false
    scene.add(r)
    return r
  }
  let pair = () => ({ zone: laid(thin, edge), fill: laid(disc, red(0)) })
  let warns = new Map<string, ReturnType<typeof pair>>()
  let warn = (eid: string) => {
    let w = warns.get(eid) ?? pair()
    warns.set(eid, w)
    return w
  }
  // The highest ground within `r` of (x, z): where a ring laid over it shows
  // whole, on a slope as on the flat.
  let highest = (x: number, z: number, r: number) => {
    let y = groundAt(v, x, z)
    for (let i = 0; i < 16; i++) {
      let a = ((i % 8) / 4) * Math.PI, d = i < 8 ? r : r / 2
      y = Math.max(y, groundAt(v, x + Math.cos(a) * d, z + Math.sin(a) * d))
    }
    return y
  }
  let at = new THREE.Vector3()

  let actor = (key: string, make: () => Figure, look = ''): Actor => {
    let a = actors.get(key)
    if (a && a.look != look) {
      scene.remove(a.fig.root)
      a = undefined
    }
    if (!a) {
      let fig = make()
      fig.root.rotation.order = 'YXZ'
      scene.add(fig.root)
      a = {
        fig,
        x: NaN,
        y: 0,
        z: 0,
        yaw: 0,
        speed: 0,
        ahead: 0,
        tumble: 0,
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
    let t = Math.max(dt, 1e-3)
    a.speed += (Math.hypot(a.x - px, a.z - pz) / t - a.speed) * 0.25
    let ahead = ((a.x - px) * Math.sin(a.yaw) + (a.z - pz) * Math.cos(a.yaw)) /
      t
    a.ahead += (ahead - a.ahead) * 0.25
    a.fig.root.position.set(a.x, a.y, a.z)
    a.fig.root.rotation.y = a.yaw
  }

  // A roll tumbles a figure head over heels about its middle, the way it is
  // going: forward, or backward when it steps back from what it faces.
  let tumble = (a: Actor, roll: number) => {
    let r = a.fig.root
    if (roll < 0) {
      a.tumble = 0
      r.rotation.x = 0
      return
    }
    if (!a.tumble && Math.abs(a.ahead) > 2) a.tumble = Math.sign(a.ahead)
    let th = a.tumble * roll * Math.PI * 2, c = a.fig.height * 0.3
    r.rotation.x = th
    r.position.y += c * (1 - Math.cos(th))
    r.position.x -= c * Math.sin(th) * Math.sin(a.yaw)
    r.position.z -= c * Math.sin(th) * Math.cos(a.yaw)
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
      tumble(mine, f.roll)
      mine.speed = f.body.speed
      let hurt = f.events.some((e) => e.type == 'hurt')
      if (hurt) mine.hurtAt = now
      play(
        mine,
        {
          air: f.body.gait == 'jump' || f.roll >= 0,
          swing: f.swing,
          hurt: Math.max(0, 1 - (now - mine.hurtAt) / 250),
          down: f.down,
        },
        t,
        dt,
      )

      // The others.
      for (let o of f.others) {
        let b = o.body
        let a = actor(o.eid, () => hero(o.look), JSON.stringify(o.look))
        glide(a, b.x, b.y, b.z, b.yaw, dt, 9)
        tumble(a, o.roll)
        if (a.swings >= 0 && o.swing > a.swings) a.swingAt = now
        a.swings = o.swing
        if (a.hp >= 0 && o.vitals.hp < a.hp) a.hurtAt = now
        a.hp = o.vitals.hp
        play(
          a,
          {
            air: b.gait == 'jump' || o.roll >= 0,
            swing: now - a.swingAt < 520 ? (now - a.swingAt) / 520 : -1,
            hurt: Math.max(0, 1 - (now - a.hurtAt) / 250),
            down: b.gait == 'down',
          },
          t,
          dt,
        )
        let life = o.vitals.hp / Math.max(1, o.vitals.max)
        plates.plate(
          o.eid,
          head(a, 0.25),
          `<span><b>${esc(o.name)}</b> <em>${o.vitals.lvl}</em></span>${
            life < 0.999 ? bar(life, 'Plate_Bar-friend') : ''
          }`,
          'Plate Plate-friend',
        )
      }

      // The creatures.
      mark.visible = false
      for (let w of warns.values()) w.zone.visible = w.fill.visible = false
      for (let m of f.mobs) {
        let b = BEASTS[m.kind]
        // Small things are lost in the haze sooner than big ones.
        if (m.near > Math.min(75, 30 + 25 * b.size)) continue
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
        play(
          a,
          {
            swing: m.bite,
            hurt: Math.max(0, 1 - m.hurt / 220),
            down: m.down,
            air: false,
          },
          t,
          dt,
        )
        // On my trail, a ring at its reach; winding up a bite, a disc that
        // grows from faint and small to fill the ring as the bite lands (0.4
        // of the way through), and holds there a moment after.
        if (m.aim && !m.down) {
          let w = warn(m.eid), y = highest(a.x, a.z, m.reach) + 0.08
          w.zone.visible = true
          w.zone.position.set(a.x, y, a.z)
          w.zone.scale.setScalar(m.reach)
          if (m.bite >= 0 && m.bite < 0.46) {
            let k = Math.min(1, m.bite / 0.4)
            w.fill.visible = true
            w.fill.position.set(a.x, y + 0.01, a.z)
            w.fill.scale.setScalar(Math.max(0.01, m.reach * k))
            w.fill.material.opacity = 0.12 + 0.5 * k
          }
        }
        let foe = f.foe?.eid == m.eid
        if (foe) {
          let r = 0.55 + b.size * 0.6
          mark.visible = true
          mark.position.set(a.x, highest(a.x, a.z, r) + 0.06, a.z)
          mark.rotation.z = t * 0.8
          mark.scale.setScalar(r)
        }
        if (!m.down && (foe || m.near < 12 || m.hurt < 4000)) {
          plates.plate(
            m.eid,
            head(a, 0.15),
            `<span><b>${esc(b.name)}</b> <em>${b.lvl}</em></span>${
              bar(m.hp / m.most, 'Plate_Bar-foe')
            }`,
            `Plate Plate-foe${b.boss ? ' Plate-boss' : ''}`,
          )
        }
      }

      // The people who give quests, with a mark over their heads when they
      // have something for me.
      for (let g of f.givers) {
        let a = actor(g.id, () => person(g.look, g.staff))
        let yaw = g.near < 8 ? Math.atan2(f.body.x - g.x, f.body.z - g.z) : 0.6
        glide(a, g.x, groundAt(v, g.x, g.z), g.z, yaw, dt, 3)
        a.speed = 0
        play(a, {}, t, dt)
        let mark = g.mark == '!'
          ? '<span class=Mark>!</span>'
          : g.mark == '?'
          ? '<span class="Mark Mark-ready">?</span>'
          : ''
        plates.plate(
          g.id,
          head(a, 0.2),
          `${mark}<b>${esc(g.name)}</b>`,
          'Plate Plate-npc',
        )
      }

      // Each road's signpost, named for the way it goes and where it leads.
      for (let r of v.roads) {
        let [x, z] = r.sign
        if (Math.hypot(x - f.body.x, z - f.body.z) > 30) continue
        plates.plate(
          `road:${r.side}`,
          at.set(x, groundAt(v, x, z) + 3.4, z),
          `${r.side[0].toUpperCase() + r.side.slice(1)} road to <b>${
            esc(LEVELS[r.to]?.name ?? r.to)
          }</b>`,
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
            for (let [min, size, hex] of (ITEMS[d.kind] ?? ITEMS.coin).look) {
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
        let w = warns.get(key)
        if (w) scene.remove(w.zone, w.fill)
        warns.delete(key)
      }
    },
    /** where someone's head is, for what floats up from them */
    headOf: (eid: string): THREE.Vector3 | null => {
      let a = actors.get(eid)
      return a ? new THREE.Vector3(a.x, a.y + a.fig.height, a.z) : null
    },
  }
}
