// What flies about for a moment: bits knocked off a creature, dust at a
// runner's heels, embers off the fire, fireflies at dusk, and the numbers
// that float up from a blow. None of it is state; it is drawn and forgotten.
// Also the labels that ride above heads (names, health), which live in the
// page's DOM and are placed over the scene every frame.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'

type Bit = {
  p: THREE.Vector3
  v: THREE.Vector3
  born: number
  life: number
  size: number
  fall: number
  color: THREE.Color
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
  mesh.frustumCulled = false
  mesh.count = 0
  mesh.castShadow = false
  scene.add(mesh)
  let live: Bit[] = []
  let m = new THREE.Matrix4()
  let q = new THREE.Quaternion()
  let s = new THREE.Vector3()
  let spin = new THREE.Euler()
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
      } = {},
    ) => {
      let c = new THREE.Color(color)
      for (let i = 0; i < n; i++) {
        if (live.length >= most) live.shift()
        let a = Math.random() * Math.PI * 2,
          sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.6)
        live.push({
          p: at.clone(),
          v: new THREE.Vector3(
            Math.cos(a) * sp,
            (o.up ?? 3) * (0.5 + Math.random()),
            Math.sin(a) * sp,
          ),
          born: performance.now(),
          life: (o.life ?? 0.7) * (0.7 + Math.random() * 0.6),
          size: (o.size ?? 0.12) * (0.7 + Math.random() * 0.6),
          fall: o.fall ?? 12,
          color: c.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.12),
        })
      }
    },
    tick: (dt: number) => {
      let t = performance.now()
      live = live.filter((b) => (t - b.born) / 1000 < b.life)
      live.forEach((b, i) => {
        b.v.y -= b.fall * dt
        b.p.addScaledVector(b.v, dt)
        let k = 1 - (t - b.born) / 1000 / b.life
        spin.set(b.born % 7 + t * 0.003, b.born % 5 + t * 0.002, 0)
        q.setFromEuler(spin)
        s.setScalar(b.size * Math.min(1, k * 2.5))
        m.compose(b.p, q, s)
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(i, b.color)
      })
      mesh.count = live.length
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
  }
}

export type Kind = 'hit' | 'great' | 'ally' | 'hurt' | 'heal' | 'xp' | 'dodge'

/** The labels over the scene: plates that follow someone, and numbers that
 * float up and fade. */
export let overlay = (layer: HTMLElement, camera: THREE.Camera) => {
  let at = new THREE.Vector3()
  let floats: { el: HTMLElement; p: THREE.Vector3; born: number }[] = []
  let plates = new Map<
    string,
    { el: HTMLElement; body: HTMLElement; html: string; seen: boolean }
  >()
  let screen = (p: THREE.Vector3): [number, number] | null => {
    at.copy(p).project(camera)
    if (at.z > 1 || at.x < -1.2 || at.x > 1.2 || at.y < -1.2 || at.y > 1.2) {
      return null
    }
    return [(at.x + 1) / 2 * innerWidth, (1 - at.y) / 2 * innerHeight]
  }
  let place = (el: HTMLElement, p: THREE.Vector3) => {
    let s = screen(p)
    el.hidden = !s
    if (s) {
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
        pl = { el, body, html: '', seen: true }
        plates.set(key, pl)
      }
      if (pl.html != html) {
        pl.body.innerHTML = html
        pl.html = html
      }
      pl.seen = true
      place(pl.el, p)
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
          pl.el.remove()
          plates.delete(key)
        }
        pl.seen = false
      }
    },
  }
}
