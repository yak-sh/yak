// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Bundle } from '@yaks/graph'
import { look } from './look.ts'
import { type Pawn, type Seat } from './room-model.ts'
import { tree } from './trees.ts'
import { field, traveler } from './world.ts'

let still = {
  orbit: [0, 0] as [number, number],
  turn: 0,
  zoom: 0,
  look: false,
  snap: false,
  faceMove: false,
}

export let roomView = (canvas: HTMLCanvasElement) => {
  let world = field(tree)
  let shape = new THREE.RingGeometry(0.26, 0.4, 16)
  shape.rotateX(-Math.PI / 2)
  let material = new THREE.MeshBasicMaterial({ color: 0xf9d29e })
  let others = Array.from({ length: 3 }, () => traveler())
  let cursors = others.map(() => new THREE.Mesh(shape, material))
  world.add(...others, ...cursors)
  let view = look(canvas, world, traveler())

  return {
    ...view,
    draw(rows: Bundle[], dt: number, member?: Seat) {
      let seat = member?.seat
      let me = (rows.find((r) => r.entity.eid === seat)?.play_pawn as
        | Pawn
        | undefined) ??
        { x: 0, z: 2 }
      let pawns = rows.filter((r) => r.entity.eid !== seat && r.play_pawn)
      for (let [i, actor] of others.entries()) {
        let pawn = pawns[i]
        let pos = pawn?.play_pawn as Pawn | undefined
        actor.visible = !!pos
        if (pos) actor.position.set(pos.x, 0, pos.z)
        let cursor = cursors[i]
        let motion = rows.find((r) =>
          (r.play_motion as { seat?: string } | undefined)?.seat ===
            pawn?.entity.eid &&
          r.play_motion
        )?.play_motion as Pawn | undefined
        cursor.visible = !!motion
        if (motion) cursor.position.set(motion.x, 0.03, motion.z)
      }
      view.draw({ x: me.x, y: 0, z: me.z, yaw: 0 }, still, dt)
    },
  }
}
