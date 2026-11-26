// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import { fixedStep } from '@yaks/game'
import { type ControlsBundle, listen } from '@yaks/game/controls'
import { kit } from '@yaks/game/hud'
import { page } from '@yaks/game/page'
import { frames } from './frames.ts'
import { themes } from '@yaks/ui/ui'
import { wear } from '@yaks/ui/wear'
import { look, type Pose } from './look.ts'
import { move, words } from './movement.ts'

export let play = async (world: THREE.Object3D, actor: THREE.Object3D) => {
  let canvas = document.querySelector('canvas')!
  let hint = document.querySelector<HTMLElement>('.Hint')!
  void wear({ kits: { hud: kit }, theme: themes.everforest }).catch(reportError)
  let front = await page({ words }).catch((error) => {
    hint.textContent = 'Could not load the game. Reload to try again.'
    reportError(error)
  })
  if (!front) return

  let view: ReturnType<typeof look>
  try {
    view = look(canvas, world, actor)
  } catch (error) {
    front.close()
    hint.textContent = 'Could not start the 3D scene. This game needs WebGL 2.'
    reportError(error)
    return
  }

  let controls = { eid: crypto.randomUUID() }
  let player = { eid: crypto.randomUUID() }
  await front.mutate([
    { entity: controls, Controls: { strafe: true } },
    { entity: player, PlayerPose: { x: 0, y: 0, z: 2, yaw: 0 } },
  ])
  let poses = front.watch('.PlayerPose', { remote: false })
  let poseOf = (row: typeof poses.value[number]) => row.PlayerPose as Pose
  let hands = listen(canvas, canvas, () => false, {
    axes: {
      KeyW: [0, 1],
      ArrowUp: [0, 1],
      KeyS: [0, -1],
      ArrowDown: [0, -1],
      KeyA: [-1, 0],
      ArrowLeft: [-1, 0],
      KeyD: [1, 0],
      ArrowRight: [1, 0],
    },
    turns: {},
    keys: {},
    gamepad: { move: [0, 1], look: [2, 3] },
    cursor: (x, y) => [x, y],
    get: () => front.ent(controls.eid) as ControlsBundle,
    onChange: (bundle) => {
      void Promise.resolve(front.mutate([bundle])).catch(reportError)
    },
  })
  let remainder = 0
  let frame = (_now: number, dt: number, elapsed: number) => {
    let intent = hands.read(dt)
    let plan = fixedStep(elapsed * 1000, remainder)
    remainder = plan.remainder
    if (intent.move.some(Boolean)) {
      for (let i = 0; i < plan.steps; i++) {
        let pose = poseOf(front.ent(player.eid)!)
        let next = move(pose, intent.move, plan.dt / 1000)
        void Promise.resolve(front.mutate([
          { entity: player, PlayerPose: next },
        ])).catch(reportError)
      }
    }
    view.draw(poseOf(poses.value[0]), { ...intent, snap: false }, dt)
  }
  frames(frame, () => {
    hands.dispose()
    front.close()
    view.dispose()
  })
}
