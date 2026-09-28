// The visual language of magic beside the existing flame effects. Earth
// throws low, falling chips; shadow leaves violet wisps through a step;
// light spreads in rays; life rises around the caster. The scene's shared
// particle pools own the meshes and their mobile limits.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { SpellElement } from './abilities.ts'
import type { bits } from './fx.ts'

type Pool = Pick<ReturnType<typeof bits>, 'emit'>

let around = (at: THREE.Vector3, angle: number, radius: number, up = 0) =>
  new THREE.Vector3(
    at.x + Math.sin(angle) * radius,
    at.y + up,
    at.z + Math.cos(angle) * radius,
  )

export let spellFx = (dust: Pool, glow: Pool) => {
  let earth = (at: THREE.Vector3, radius: number, n: number) => {
    for (let i = 0; i < n; i++) {
      dust.emit(
        around(at, i * Math.PI * 2 / n, radius, 0.25),
        i % 3 ? 0xc79a63 : 0xf4d596,
        2,
        {
          speed: 1.5,
          up: 2,
          fall: 5,
          life: 1,
          size: 0.34,
        },
      )
    }
  }
  let shadow = (at: THREE.Vector3, n: number) => {
    glow.emit(at, 0xa667e8, n, {
      speed: 1.1,
      up: 0.5,
      fall: -0.3,
      life: 0.8,
      size: 0.12,
      halo: true,
    })
    glow.emit(at, 0x6238a8, Math.ceil(n / 2), {
      speed: 0.5,
      up: -0.5,
      fall: -0.5,
      life: 0.9,
      size: 0.19,
    })
  }
  return {
    cast: (element: SpellElement, at: THREE.Vector3, radius = 1) => {
      if (element == 'earth') earth(at, radius, 14)
      if (element == 'shadow') {
        for (let i = 0; i < 8; i++) {
          shadow(around(at, i * Math.PI / 4, 0.7, 0.6 + i % 2 * 0.8), 2)
        }
      }
      if (element == 'light') {
        for (let i = 0; i < 12; i++) {
          let p = around(at, i * Math.PI / 6, 0.75, 0.6 + i % 2 * 0.9)
          glow.emit(p, i % 3 ? 0xffe5a0 : 0xffffff, 2, {
            speed: 0.35,
            up: 0.7,
            fall: 0,
            life: 0.85,
            size: 0.17,
            halo: true,
          })
        }
      }
      if (element == 'life') {
        for (let i = 0; i < 12; i++) {
          let p = around(at, i * Math.PI / 3, 0.55, 0.2 + i * 0.1)
          glow.emit(p, i % 3 ? 0x76e887 : 0xd7ffac, 2, {
            speed: 0.3,
            up: 1.8,
            fall: -0.6,
            life: 1.1,
            size: 0.16,
            halo: i % 3 == 0,
          })
        }
      }
    },
    travel: (element: SpellElement, from: THREE.Vector3, to: THREE.Vector3) => {
      if (element != 'shadow') return
      for (let i = 0; i <= 8; i++) {
        let p = from.clone().lerp(to, i / 8)
        p.y += 0.5 + Math.sin(i / 8 * Math.PI) * 0.5
        shadow(p, 2)
      }
    },
    hit: (element: SpellElement, at: THREE.Vector3, radius = 1) => {
      if (element == 'earth') earth(at, Math.min(radius, 3), 8)
      if (element == 'shadow') shadow(at, 20)
    },
  }
}
