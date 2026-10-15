// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'

/** The shared WebGL renderer. Sizing and density are values supplied by the page. */
export let renderer = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  density: number,
): THREE.WebGLRenderer => {
  let renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(density)
  renderer.setSize(width, height, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  return renderer
}

/** Lower quality once per slow sampling window; no game or loading policy. */
export let keepUp = (
  ease: (() => void)[],
  window = 3,
  rate = 45,
): (spent: number) => void => {
  let t = 0, n = 0, eased = 0
  return (spent: number) => {
    t += spent
    n++
    if (t < window) return
    if (t / n > 1 / rate && eased < ease.length) ease[eased++]()
    t = n = 0
  }
}

/** Ordered reductions keep simulation on the display clock before looks. */
export let quality = (
  renderer: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight,
  scene: THREE.Scene,
  density: number,
): (() => void)[] => [
  () => renderer.setPixelRatio(Math.min(density, 1.25)),
  () => renderer.setPixelRatio(1),
  () => {
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.map?.dispose()
    sun.shadow.map = null
  },
  () => renderer.setPixelRatio(0.75),
  () => {
    renderer.shadowMap.enabled = false
    sun.castShadow = false
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        for (let m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.needsUpdate = true
        }
      }
    })
  },
]

/** An animation callback with elapsed time and a bounded simulation step.
 * Scheduling is handed in, so the page owns starting and stopping it. */
export let frameLoop = (
  frame: (now: number, dt: number, elapsed: number) => void,
  then: number,
  schedule: (frame: FrameRequestCallback) => unknown = requestAnimationFrame,
): FrameRequestCallback => {
  let loop = (now: number) => {
    schedule(loop)
    let elapsed = (now - then) / 1000
    then = now
    frame(now, Math.min(0.05, elapsed), elapsed)
  }
  return loop
}
