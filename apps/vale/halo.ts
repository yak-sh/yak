// One soft radial texture for the vale's lamps and the magic carried by a
// hero. The scene makes coloured, additive sprites from this shared map.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'

let map: THREE.CanvasTexture | undefined

export let halo = (): THREE.CanvasTexture => {
  if (map) return map
  let c = document.createElement('canvas')
  c.width = c.height = 64
  let g = c.getContext('2d')!
  let r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,0.9)')
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  return map = new THREE.CanvasTexture(c)
}
