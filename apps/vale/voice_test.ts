import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import { loud, near, TALK } from './voice.ts'
import type { Body } from './sim.ts'

const at = (x: number, z: number, yaw = 0) =>
  ({ x, y: 0, z, vy: 0, yaw, speed: 0, gait: 'idle' }) as Body

Deno.test('voice distance has one owner: full through 20 m and a fade to 30 m', () => {
  // A PannerNode with zero inverse rolloff still pans speech, but cannot
  // quietly multiply loud() by 3/d as the old TALK did.
  assertEquals(TALK.pan.panningModel, 'HRTF')
  assertEquals(TALK.pan.distanceModel, 'inverse')
  assertEquals(TALK.pan.rolloffFactor, 0)
  assertEquals(TALK.near, 1)
  assertEquals(loud(at(0, 0), at(0, 2)), 1)
  assertEquals(loud(at(0, 0), at(0, 20)), 1)
  assertEquals(loud(at(0, 0), at(0, 25)), 0.5)
  assertAlmostEquals(loud(at(0, 0), at(0, 29)), 0.1)
  assertEquals(loud(at(0, 0), at(0, 30)), 0)
  assertEquals(loud(at(0, 0), at(0, 31)), 0)
  assertEquals(loud(at(0, 0), at(0, -20)), 0.5)
  assert(loud(at(0, 0), at(10, 0)) > 0.5)
})

Deno.test('party speech stays audible when its speaker crosses the vale', () => {
  assertEquals(loud(at(0, 0), at(0, 10), true), 1)
  assertEquals(loud(at(0, 0), at(0, 30), true), 0.18)
  assertEquals(loud(at(0, 0), at(0, 300), true), 0.18)
  assertEquals(near(300, false, true), true)
  assertEquals(near(300, false), false)
})
