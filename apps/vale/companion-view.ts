// The companion on stage and the short report beside the game controls.
// Its state comes from companion.ts; the figure and words have no store access.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { BUILD, hero } from './figures.ts'
import type { Companion } from './companion.ts'

export let companionView = (scene: THREE.Scene, hud: HTMLElement) => {
  let figure = hero(BUILD, {
    tint: '#b5a87a',
    hair: '#76583c',
    skin: '#c9926a',
  })
  figure.root.scale.setScalar(0.9)
  scene.add(figure.root)
  let note = document.createElement('div')
  note.className = 'Companion'
  note.setAttribute('role', 'status')
  hud.append(note)
  let was: [number, number, number] | null = null
  return {
    show: (s: ReturnType<Companion['tick']>, dt: number, now: number) => {
      figure.root.visible = !!s.at
      note.hidden = !s.status
      if (note.textContent != s.status) note.textContent = s.status
      if (!s.at) {
        was = null
        return
      }
      let [x, y, z] = s.at
      figure.root.position.set(x, y, z)
      if (was && s.speed > 0.01) {
        figure.root.rotation.y = Math.atan2(x - was[0], z - was[2])
      }
      figure.animate({
        speed: s.speed,
        air: false,
        swing: s.swing,
        hurt: 0,
        roll: -1,
        down: false,
        t: now / 1000,
      }, dt)
      was = s.at
    },
  }
}
