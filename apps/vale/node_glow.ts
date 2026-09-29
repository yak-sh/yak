// Persistent rarity light around the resource nodes in sight. One shared halo
// texture and a capped number of sprites keep the effect bounded on phones.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { bits } from './fx.ts'
import { halo } from './halo.ts'
import { GRADES, type Rarity } from './rarity.ts'
import { hashOf } from './rand.ts'
import type { Seen } from './work.ts'

let LOOK: Record<
  Exclude<Rarity, 'common'>,
  {
    size: number
    opacity: number
    rate: number
    mote: number
    life: number
    speed: number
    up: number
    halo: number
  }
> = {
  uncommon: {
    size: 2.5,
    opacity: 0.5,
    rate: 8,
    mote: 0.21,
    life: 1.4,
    speed: 0.35,
    up: 0.45,
    halo: 0.55,
  },
  rare: {
    size: 3.4,
    opacity: 0.65,
    rate: 11,
    mote: 0.25,
    life: 1.5,
    speed: 0.5,
    up: 0.7,
    halo: 0.7,
  },
  epic: {
    size: 4.5,
    opacity: 0.8,
    rate: 16,
    mote: 0.28,
    life: 1.7,
    speed: 0.65,
    up: 0.9,
    halo: 0.9,
  },
  legendary: {
    size: 5.8,
    opacity: 1,
    rate: 20,
    mote: 0.31,
    life: 1.8,
    speed: 0.8,
    up: 1.1,
    halo: 1,
  },
}
let HEIGHT = { tree: 2.1, seam: 0.9, herb: 0.7, shoal: 0.25 }
let SPREAD = { tree: 1.5, seam: 1.2, herb: 0.9, shoal: 1 }
type Light = {
  sprite: THREE.Sprite
  ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  motes: number
  step: number
}

export let nodeGlow = (
  scene: THREE.Scene,
  particles: Pick<ReturnType<typeof bits>, 'emit'>,
  phone: boolean,
) => {
  let live = new Map<string, Light>()
  let groundGeo = new THREE.PlaneGeometry(1, 1)
  let chosen = new Set<string>()
  let seen = new Set<string>()
  let share = 1
  return {
    begin: (nodes: Seen[]) => {
      let reach = phone ? 32 : 40
      let most = phone ? 12 : 28
      let selected = nodes.filter((n) =>
        !n.spent && n.rarity != 'common' && n.near < reach
      ).sort((a, b) => a.near - b.near).slice(0, most)
      chosen = new Set(
        selected.map((n) => n.eid),
      )
      let rate = selected.reduce(
        (sum, n) => sum + (n.rarity == 'common' ? 0 : LOOK[n.rarity].rate),
        0,
      )
      share = rate ? Math.min(1, (phone ? 48 : 96) / rate) : 1
      seen.clear()
    },
    show: (n: Seen, at: THREE.Vector3, dt: number, t: number) => {
      if (!chosen.has(n.eid) || n.rarity == 'common') return
      seen.add(n.eid)
      let glow = live.get(n.eid)
      if (!glow) {
        let sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: halo(),
            color: GRADES[n.rarity].light,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            fog: false,
          }),
        )
        let ground = new THREE.Mesh(
          groundGeo,
          new THREE.MeshBasicMaterial({
            map: halo(),
            color: GRADES[n.rarity].light,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
            fog: false,
            side: THREE.DoubleSide,
          }),
        )
        ground.rotation.x = -Math.PI / 2
        glow = { sprite, ground, motes: 0, step: 0 }
        scene.add(ground, sprite)
        live.set(n.eid, glow)
      }
      let look = LOOK[n.rarity]
      let wave = Math.sin(t * 2.5 + hashOf(n.eid) * 0.01)
      glow.sprite.position.set(
        at.x,
        at.y + HEIGHT[n.lode.look.plan],
        at.z,
      )
      glow.sprite.scale.setScalar(look.size * (1 + wave * 0.07))
      glow.sprite.material.color.setHex(GRADES[n.rarity].light)
        .multiplyScalar(1.8)
      glow.sprite.material.opacity = look.opacity * (0.9 + wave * 0.1)
      glow.ground.position.set(at.x, at.y + 0.04, at.z)
      glow.ground.scale.setScalar(look.size * 1.1 * (1 + wave * 0.04))
      glow.ground.material.color.setHex(GRADES[n.rarity].light)
        .multiplyScalar(1.8)
      glow.ground.material.opacity = look.opacity * 0.7
      glow.motes += Math.min(dt, 0.1) * look.rate * share
      let count = Math.floor(glow.motes)
      glow.motes -= count
      for (let i = 0; i < count; i++) {
        let step = glow.step++
        let angle = Math.random() * Math.PI * 2
        let radius = SPREAD[n.lode.look.plan] * Math.sqrt(Math.random())
        let flame = n.rarity == 'legendary' && step % 3 == 0
        particles.emit(
          new THREE.Vector3(
            at.x + Math.cos(angle) * radius,
            at.y + HEIGHT[n.lode.look.plan] * 0.6 +
              Math.random() * (HEIGHT[n.lode.look.plan] + 0.8),
            at.z + Math.sin(angle) * radius,
          ),
          GRADES[n.rarity].light,
          1,
          {
            speed: look.speed,
            up: look.up,
            life: look.life,
            size: flame ? look.mote * 0.8 : look.mote,
            fall: 0,
            halo: Math.random() < look.halo,
            flame,
          },
        )
      }
    },
    end: () => {
      for (let [eid, glow] of live) {
        if (seen.has(eid)) continue
        glow.sprite.removeFromParent()
        glow.sprite.material.dispose()
        glow.ground.removeFromParent()
        glow.ground.material.dispose()
        live.delete(eid)
      }
    },
    dispose: () => {
      for (let glow of live.values()) {
        glow.sprite.removeFromParent()
        glow.sprite.material.dispose()
        glow.ground.removeFromParent()
        glow.ground.material.dispose()
      }
      live.clear()
      groundGeo.dispose()
    },
  }
}
