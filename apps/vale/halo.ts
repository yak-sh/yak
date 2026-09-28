// One soft radial texture for the vale's lamps and the magic carried by a
// hero. The scene makes coloured, additive sprites from this shared map.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'

let map: THREE.DataTexture | undefined

export let halo = (): THREE.DataTexture => {
  if (map) return map
  let size = 64, pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = Math.min(1, Math.hypot(x - 31.5, y - 31.5) / 31.5)
      let alpha = r < 0.35 ? 0.9 - 0.55 * r / 0.35 : 0.35 * (1 - r) / 0.65
      let i = (y * size + x) * 4
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255
      pixels[i + 3] = Math.round(255 * alpha)
    }
  }
  map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat)
  map.minFilter = map.magFilter = THREE.LinearFilter
  map.needsUpdate = true
  return map
}
