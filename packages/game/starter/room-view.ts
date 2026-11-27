// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import type { Bundle } from '@yaks/graph'
import { look } from './look.ts'
import { type Pawn, type Seat } from './room-model.ts'
import { type Battle } from './room-rules.ts'
import { tree } from './trees.ts'
import { beast, field, traveler } from './world.ts'

let still = {
  orbit: [0, 0] as [number, number],
  turn: 0,
  zoom: 0,
  look: false,
  snap: false,
  faceMove: false,
}

// A knocked-out piece lies on its side.
let lay = (actor: THREE.Object3D, down: boolean) => {
  actor.rotation.z = down ? Math.PI / 2 : 0
}

export let roomView = (canvas: HTMLCanvasElement) => {
  let world = field(tree)
  let shape = new THREE.RingGeometry(0.26, 0.4, 16)
  shape.rotateX(-Math.PI / 2)
  let material = new THREE.MeshBasicMaterial({ color: 0xf9d29e })
  let others = Array.from({ length: 3 }, () => traveler())
  let cursors = others.map(() => new THREE.Mesh(shape, material))
  world.add(...others, ...cursors)
  let foes = new Map<string, THREE.Group>()
  let self = traveler()
  let view = look(canvas, world, self)

  return {
    ...view,
    draw(
      rows: Bundle[],
      { party, foes: enemies }: Battle,
      dt: number,
      member?: Seat,
    ) {
      let seat = member?.seat
      let me = party.find((p) => p.eid === seat) ?? { x: 0, z: 2, hp: 1 }
      lay(self, me.hp <= 0)
      let pawns = party.filter((p) => p.eid !== seat)
      for (let [i, actor] of others.entries()) {
        let pawn = pawns[i]
        actor.visible = !!pawn
        if (pawn) {
          actor.position.set(pawn.x, 0, pawn.z)
          lay(actor, pawn.hp <= 0)
        }
        let cursor = cursors[i]
        let motion = rows.find((r) =>
          (r.play_motion as { seat?: string } | undefined)?.seat ===
            pawn?.eid && r.play_motion
        )?.play_motion as Pawn | undefined
        cursor.visible = !!motion
        if (motion) cursor.position.set(motion.x, 0.03, motion.z)
      }
      for (let foe of enemies) {
        let actor = foes.get(foe.eid)
        if (!actor) {
          foes.set(foe.eid, actor = beast(foe.kind))
          world.add(actor)
        }
        actor.visible = foe.hp > 0
        actor.position.set(foe.x, 0, foe.z)
      }
      view.draw({ x: me.x, y: 0, z: me.z, yaw: 0 }, still, dt)
    },
  }
}
