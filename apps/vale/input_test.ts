// Vale's controls adapter and its screen-space stride integration.
import { equal, ok, test } from '@yaks/testing'
import { assertAlmostEquals } from '@std/assert'
import {
  controlsFixture,
  controlsProbe,
  pad,
} from '../../packages/game/controls_test_support.ts'
import { cursor } from '@yaks/stage/aim'
import { keysOf, listen, movement } from './input.ts'
import type { Body } from './sim.ts'
import { stride } from './stride.ts'
import { flat } from './terrain.ts'

let probeTest = (
  name: string,
  run: Parameters<typeof controlsProbe<ReturnType<typeof listen>>>[1],
) => test(name, controlsFixture(listen).bind(null, run))
let ground = flat(5)

probeTest('left touch walks right while right touch orbits', (p) => {
  let pointer = (type: string, id: number, x: number, y: number) =>
    p.send(type, {
      pointerType: 'touch',
      pointerId: id,
      clientX: x,
      clientY: y,
    })
  pointer('pointerdown', 1, 100, 100)
  pointer('pointermove', 1, 156, 100)
  pointer('pointerdown', 2, 700, 100)
  pointer('pointermove', 2, 740, 100)
  let i = p.hands.read()
  equal(i.move, [1, 0])
  equal(i.faceMove, true)
  equal(i.look, true)
  assertAlmostEquals(i.orbit[0], -0.36)
})

test('a stride faces a screen-right walk while the view orbits', () => {
  let body: Body = {
    x: 20,
    y: 5,
    z: 20,
    vy: 0,
    yaw: Math.PI,
    speed: 0,
    gait: 'idle',
  }
  let stepped = stride(ground, body, [1, 0], -0.36, 0.1, 5, false, true, true)
  ok(stepped.x > body.x)
  assertAlmostEquals(stepped.yaw, Math.PI / 2 - 0.36)
})

for (
  let [code, verb] of [
    ['KeyF', 'strike'],
    ['KeyJ', 'strike'],
    ['ShiftLeft', 'dodge'],
    ['KeyE', 'talk'],
    ['KeyG', 'gather'],
    ['KeyQ', 'drink'],
    ['KeyC', 'snap'],
    ['KeyT', 'mic'],
  ] as const
) {
  probeTest(`Vale ${code} emits ${verb} on its press edge`, (p) => {
    p.send('keydown', { code })
    equal(p.hands.read()[verb], true, code)
    equal(p.hands.read()[verb], false, code)
    p.send('keyup', { code })
  })
}

probeTest('Vale holds jump until Space releases', (p) => {
  p.send('keydown', { code: 'Space' })
  equal(p.hands.read().jump, true)
  equal(p.hands.read().jump, true)
  p.send('keyup', { code: 'Space' })
  equal(p.hands.read().jump, false)
})

for (let slot of [1, 2, 3]) {
  probeTest(`Vale Digit${slot} emits ability ${slot} once`, (p) => {
    p.send('keydown', { code: `Digit${slot}` })
    equal(p.hands.read().ability, slot)
    equal(p.hands.read().ability, 0)
    p.send('keyup', { code: `Digit${slot}` })
  })
}

probeTest('Vale screen abilities and key hints use adapter bindings', (p) => {
  p.hands.press('ability2')
  equal(p.hands.read().ability, 2)
  equal(keysOf('strike'), ['KeyF', 'KeyJ'])
  equal(movement(['KeyW', 'ArrowLeft'], false).turn, -6)
  equal(movement(['KeyA'], true).move, [-1, 0])
})

for (let [button, verb] of [[2, 'dodge'], [0, 'strike']] as const) {
  probeTest(`Vale maps a button ${button} tap to ${verb}`, (p) => {
    p.hands.hideCursor()
    p.send('pointerdown', {
      button,
      buttons: button == 0 ? 1 : 2,
      clientX: 200,
      clientY: 150,
    })
    p.send('pointerup', { button, buttons: 0, clientX: 200, clientY: 150 })
    let i = p.hands.read()
    equal(i[verb], true)
    if (button == 0) equal(i.pick, cursor(200, 150, 800, 600, false))
  })
}

probeTest('Vale projects the cursor without owning controls state', (p) => {
  p.send('pointermove', { clientX: 600, clientY: 450 })
  equal(p.hands.pointer(), cursor(600, 450, 800, 600, false))
  ok(p.changes.length > 0)
  ok(p.changes.every((b) => b.entity.eid == 'test-consumer:pilot-controls'))
})

for (
  let [button, verb] of [
    [1, 'dodge'],
    [2, 'strike'],
    [3, 'talk'],
    [6, 'drink'],
    [9, 'snap'],
  ] as const
) {
  probeTest(
    `Vale gamepad button ${button} emits ${verb} on its press edge`,
    (p) => {
      p.pads([pad([], [button])])
      equal(p.hands.read()[verb], true)
      equal(p.hands.read()[verb], false)
      p.pads([])
      p.hands.read()
    },
  )
}

for (let [button, slot] of [[4, 1], [5, 2], [7, 3]]) {
  probeTest(`Vale gamepad button ${button} emits ability ${slot} once`, (p) => {
    p.pads([pad([], [button])])
    equal(p.hands.read().ability, slot)
    equal(p.hands.read().ability, 0)
    p.pads([])
    p.hands.read()
  })
}

probeTest(
  'Vale gamepad holds jump with movement and orbit until release',
  (p) => {
    p.pads([pad([0, -1, 1, 0], [0])])
    let i = p.hands.read(0.25)
    equal(i.move, [0, 1])
    assertAlmostEquals(i.orbit[0], -0.75)
    equal(i.jump, true)
    equal(p.hands.read().jump, true)
    p.pads([])
    equal(p.hands.read().jump, false)
  },
)
