import type { VocabDoc } from '@yaks/vocab'
import type { Pose } from './look.ts'

export let words: VocabDoc[] = [{
  $defs: {
    PlayerPose: {
      component: true,
      type: 'object',
      sync: 'none',
      durable: 'connection',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        yaw: { type: 'number' },
      },
    },
  },
}]

let bound = (value: number) => Math.max(-11.5, Math.min(11.5, value))

export let move = (
  pose: Pose,
  [x, forward]: [number, number],
  dt: number,
): Pose => ({
  x: bound(pose.x + x * 4 * dt),
  y: pose.y,
  z: bound(pose.z - forward * 4 * dt),
  yaw: Math.atan2(x, forward),
})
