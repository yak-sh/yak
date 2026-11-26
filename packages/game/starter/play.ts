// @ts-types="npm:@types/three@^0.186.0"
import type * as THREE from 'three'
import { type ControlsBundle, listen } from '@yaks/game/controls'
import { kit } from '@yaks/game/hud'
import { frameLoop } from '@yaks/stage/render'
import { themes } from '@yaks/ui/ui'
import { wear } from '@yaks/ui/wear'
import { look, type Pose } from './look.ts'

export let play = (world: THREE.Object3D, actor: THREE.Object3D): void => {
  let canvas = document.querySelector('canvas')!
  let hint = document.querySelector<HTMLElement>('.Hint')!
  void wear({ kits: { hud: kit }, theme: themes.everforest }).catch(reportError)
  let view: ReturnType<typeof look>
  try {
    view = look(canvas, world, actor)
  } catch (error) {
    hint.textContent = 'Could not start the 3D scene. This game needs WebGL 2.'
    reportError(error)
    return
  }

  let input: ControlsBundle = {
    entity: { eid: crypto.randomUUID() },
    Controls: { strafe: true },
  }
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
    get: () => input,
    onChange: (bundle) => {
      input = bundle
    },
  })
  let pose: Pose = { x: 0, y: 0, z: 2, yaw: 0 }
  let bound = (value: number) => Math.max(-11.5, Math.min(11.5, value))
  let frame = (_now: number, dt: number) => {
    let intent = hands.read(dt)
    let [x, forward] = intent.move
    pose = {
      x: bound(pose.x + x * 4 * dt),
      y: pose.y,
      z: bound(pose.z - forward * 4 * dt),
      yaw: x || forward ? Math.atan2(x, forward) : pose.yaw,
    }
    view.draw(pose, { ...intent, snap: false }, dt)
  }
  let pending: number
  let schedule = (next: FrameRequestCallback) =>
    pending = requestAnimationFrame(next)
  let start = () => schedule(frameLoop(frame, performance.now(), schedule))
  addEventListener('pagehide', (event) => {
    cancelAnimationFrame(pending)
    if (event.persisted) return
    hands.dispose()
    view.dispose()
  })
  addEventListener('pageshow', (event) => {
    if (event.persisted) start()
  })
  start()
}
