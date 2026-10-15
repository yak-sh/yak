import { equal, test } from '@yaks/testing'
import { frameLoop, keepUp } from './render.ts'

test('slow windows lower quality one step, fast windows keep it', () => {
  let changes: number[] = []
  let adapt = keepUp([() => changes.push(1), () => changes.push(2)], 0.1)
  for (let n = 0; n < 10; n++) adapt(0.01)
  equal(changes, [])
  for (let n = 0; n < 5; n++) adapt(0.04)
  equal(changes, [1])
  for (let n = 0; n < 10; n++) adapt(0.04)
  equal(changes, [1, 2])
})

test('the frame loop schedules once and bounds simulation but not elapsed time', () => {
  let queued: FrameRequestCallback[] = [], frames: number[][] = []
  let loop = frameLoop(
    (...args) => frames.push(args),
    1000,
    (f) => queued.push(f),
  )
  loop(1200)
  equal(frames, [[1200, 0.05, 0.2]])
  equal(queued.length, 1)
  queued.pop()!(1210)
  equal(frames[1], [1210, 0.01, 0.01])
})
