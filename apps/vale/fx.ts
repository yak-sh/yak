// What flies about for a moment: bits knocked off a creature, dust at a
// runner's heels, embers off the fire, fireflies at dusk, and the numbers
// that float up from a blow. None of it is state; it is drawn and forgotten.
// Also the labels that ride above heads (names, health), which live in the
// page's DOM and are placed over the scene every frame.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { halo } from './halo.ts'

type Bit = {
  p: THREE.Vector3
  v: THREE.Vector3
  born: number
  life: number
  size: number
  fall: number
  color: THREE.Color
  halo: boolean
  flame: boolean
}

/** A pool of little cubes: `lit` ones are shaded like the world, the others
 * glow. */
export let bits = (scene: THREE.Scene, lit: boolean, most = 500) => {
  let material = lit
    ? new THREE.MeshLambertMaterial({ color: 0xffffff })
    : new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  let mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    most,
  )
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  // The first emitted bit must not change this mesh's shader variant.
  mesh.setColorAt(0, new THREE.Color(0xffffff))
  mesh.frustumCulled = false
  mesh.count = 0
  mesh.castShadow = false
  scene.add(mesh)
  let flames = lit ? null : new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.5, 1, 5),
    material,
    Math.min(most, 80),
  )
  if (flames) {
    flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    flames.setColorAt(0, new THREE.Color(0xffffff))
    flames.frustumCulled = false
    flames.count = 0
    scene.add(flames)
  }
  let halos = lit ? null : new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: halo(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
    Math.min(most, 64),
  )
  if (halos) {
    halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    halos.setColorAt(0, new THREE.Color(0xffffff))
    halos.frustumCulled = false
    halos.count = 0
    scene.add(halos)
  }
  let live: Bit[] = []
  let m = new THREE.Matrix4()
  let q = new THREE.Quaternion()
  let s = new THREE.Vector3()
  let spin = new THREE.Euler()
  let tint = new THREE.Color()
  return {
    /** `n` bits from `at`, flung up to `speed` metres a second */
    emit: (
      at: THREE.Vector3,
      color: THREE.ColorRepresentation,
      n: number,
      o: {
        speed?: number
        up?: number
        life?: number
        size?: number
        fall?: number
        halo?: boolean
        flame?: boolean
      } = {},
    ) => {
      let c = new THREE.Color(color)
      for (let i = 0; i < n; i++) {
        if (live.length >= most) live.shift()
        let a = Math.random() * Math.PI * 2,
          sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.6),
          flame = !!o.flame
        let p = at.clone()
        if (flame) {
          p.add(
            new THREE.Vector3(
              Math.cos(a) * Math.random() * 0.18,
              0,
              Math.sin(a) * Math.random() * 0.18,
            ),
          )
        }
        live.push({
          p,
          v: new THREE.Vector3(
            Math.cos(a) * sp * (flame ? 0.15 : 1),
            (o.up ?? 3) *
              (flame ? 0.8 + Math.random() * 0.6 : 0.5 + Math.random()),
            Math.sin(a) * sp * (flame ? 0.15 : 1),
          ),
          born: performance.now(),
          life: (o.life ?? 0.7) * (0.7 + Math.random() * 0.6),
          size: (o.size ?? 0.12) * (0.7 + Math.random() * 0.6),
          fall: o.fall ?? (flame ? -0.4 : 12),
          color: flame
            ? new THREE.Color(
              i % 3 == 0 ? 0xffe28a : i % 3 == 1 ? 0xffa334 : 0xff5525,
            )
            : c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.12),
          halo: !!o.halo || (flame && i % 3 == 0),
          flame,
        })
      }
    },
    tick: (dt: number, camera?: THREE.Camera) => {
      let t = performance.now()
      live = live.filter((b) => (t - b.born) / 1000 < b.life)
      let cubes = 0, tongues = 0
      for (let i = live.length - 1; i >= 0; i--) {
        let b = live[i]
        b.v.y -= b.fall * dt
        b.p.addScaledVector(b.v, dt)
        let k = 1 - (t - b.born) / 1000 / b.life
        spin.set(
          b.flame ? 0 : b.born % 7 + t * 0.003,
          b.flame ? 0 : b.born % 5 + t * 0.002,
          b.flame ? Math.sin(t * 0.012 + b.born) * 0.2 : 0,
        )
        q.setFromEuler(spin)
        let fade = Math.min(1, k * 2.5)
        s.setScalar(b.size * fade)
        if (b.flame) s.y *= 2.8
        m.compose(b.p, q, s)
        if (b.flame) {
          if (flames && tongues < flames.instanceMatrix.count) {
            flames.setMatrixAt(tongues, m)
            flames.setColorAt(tongues++, b.color)
          }
        } else {
          mesh.setMatrixAt(cubes, m)
          mesh.setColorAt(cubes++, b.color)
        }
      }
      mesh.count = cubes
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      if (flames) {
        flames.count = tongues
        flames.instanceMatrix.needsUpdate = true
        if (flames.instanceColor) flames.instanceColor.needsUpdate = true
      }
      if (halos) {
        let shown = 0
        q.copy(camera?.quaternion ?? mesh.quaternion)
        for (
          let i = live.length - 1;
          i >= 0 && shown < halos.instanceMatrix.count;
          i--
        ) {
          let b = live[i]
          if (!b.halo) continue
          let k = 1 - (t - b.born) / 1000 / b.life
          s.setScalar(b.size * (b.flame ? 5 : 4) * Math.min(1, k * 2.5))
          m.compose(b.p, q, s)
          halos.setMatrixAt(shown, m)
          halos.setColorAt(shown++, tint.copy(b.color).multiplyScalar(k))
        }
        halos.count = shown
        halos.instanceMatrix.needsUpdate = true
        if (halos.instanceColor) halos.instanceColor.needsUpdate = true
      }
    },
  }
}

export type Kind =
  | 'hit'
  | 'great'
  | 'ally'
  | 'hurt'
  | 'heal'
  | 'xp'
  | 'dodge'
  | 'ability'
  | 'ward'

/** Whether a box on the screen, `w` by `h` from its top left at `x`, `y`,
 * lies under the glass, where the scene's labels do not show. */
export type Under = (x: number, y: number, w: number, h: number) => boolean

/** The labels over the scene: plates that follow someone, and numbers that
 * float up and fade. A label that would be `under` the glass is not shown. */
export let overlay = (
  layer: HTMLElement,
  camera: THREE.Camera,
  under: Under = () => false,
) => {
  let at = new THREE.Vector3()
  let floats: { el: HTMLElement; p: THREE.Vector3; born: number }[] = []
  // Sizes arrive after layout, so drawing a plate never asks for layout.
  type Plate = {
    el: HTMLElement
    body: HTMLElement
    html: string
    seen: boolean
    w: number
    h: number
  }
  let plates = new Map<string, Plate>()
  let byBody = new WeakMap<Element, Plate>()
  let sized = new ResizeObserver((entries) => {
    for (let entry of entries) {
      let pl = byBody.get(entry.target)
      if (!pl) continue
      pl.w = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width
      pl.h = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
    }
  })
  let screen = (p: THREE.Vector3): [number, number] | null => {
    at.copy(p).project(camera)
    if (at.z > 1 || at.x < -1.2 || at.x > 1.2 || at.y < -1.2 || at.y > 1.2) {
      return null
    }
    return [(at.x + 1) / 2 * innerWidth, (1 - at.y) / 2 * innerHeight]
  }
  // Put `el` over `p`, unless `p` is off the screen or what `el` shows, `w`
  // by `h` and standing on the point, would be under the glass.
  let place = (el: HTMLElement, p: THREE.Vector3, w = 0, h = 0) => {
    let s = screen(p)
    let shown = !!s && !under(s[0] - w / 2, s[1] - h, w, h)
    // Keep plates laid out while occluded: a display:none plate measures 0x0
    // in ResizeObserver, so its next frame tests a different overlap and
    // alternates between hidden and shown at the edge of the glass.
    el.style.visibility = shown ? '' : 'hidden'
    if (s && shown) {
      el.style.transform = `translate(${s[0].toFixed(1)}px, ${
        s[1].toFixed(1)
      }px)`
    }
  }
  return {
    float: (text: string, p: THREE.Vector3, kind: Kind) => {
      let el = document.createElement('div')
      el.className = `Float Float-${kind}`
      el.textContent = text
      layer.append(el)
      let jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        0,
        (Math.random() - 0.5) * 0.6,
      )
      floats.push({ el, p: p.clone().add(jitter), born: performance.now() })
    },
    /** keep a plate over `p` this frame, holding `html` */
    plate: (key: string, p: THREE.Vector3, html: string, cls = 'Plate') => {
      let pl = plates.get(key)
      if (!pl) {
        let el = document.createElement('div')
        el.className = cls
        let body = document.createElement('div')
        body.className = 'Plate_In'
        el.append(body)
        layer.append(el)
        pl = { el, body, html: '', seen: true, w: 0, h: 0 }
        plates.set(key, pl)
        byBody.set(body, pl)
        sized.observe(body)
      }
      if (pl.html != html) {
        pl.body.innerHTML = html
        pl.html = html
      }
      pl.seen = true
      place(pl.el, p, pl.w, pl.h)
    },
    tick: () => {
      let t = performance.now()
      floats = floats.filter((f) => {
        let age = (t - f.born) / 1000
        if (age > 1.1) {
          f.el.remove()
          return false
        }
        f.p.y += 0.018
        place(f.el, f.p)
        f.el.style.opacity = String(Math.min(1, (1.1 - age) * 3))
        return true
      })
      for (let [key, pl] of plates) {
        if (!pl.seen) {
          sized.unobserve(pl.body)
          pl.el.remove()
          plates.delete(key)
        }
        pl.seen = false
      }
    },
  }
}
