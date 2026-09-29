// Stone markers on the bridge decks over the world's rivers.
import { box, type Vox } from '../mesh.ts'
import { type Kind, type Model } from './kit.ts'

let bridgepost = (): Model => {
  let vox: Vox = new Map()
  box(vox, [-1, 0, -1], [1, 5, 1], 0xaaa69d)
  box(vox, [-2, 5, -2], [2, 6, 2], 0xc7c2b4)
  return { vox, size: 0.25 }
}

let bridgewall = (): Model => {
  let vox: Vox = new Map()
  box(vox, [-2, 0, -1], [2, 3, 1], 0xaaa69d)
  box(vox, [-2, 3, -1], [2, 4, 1], 0xc7c2b4)
  return { vox, size: 0.25 }
}

export let LANDMARKS: Record<string, Kind> = {
  bridgepost: { make: bridgepost, solid: true, foot: 0.5 },
  bridgewall: { make: bridgewall, girth: 0.3, row: 0.65, foot: 0.8 },
}
