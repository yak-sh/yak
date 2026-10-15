// Vale's controls adapter and its screen-space stride integration.
import { equal, ok, test } from '@yaks/testing'
import { assertAlmostEquals } from '@std/assert'
import {
  controlsProbe,
  pad,
} from '../../packages/game/controls_test_support.ts'
import { cursor } from '@yaks/stage/aim'
import { keysOf, listen, movement } from './input.ts'
import type { Body } from './sim.ts'
import { stride } from './stride.ts'
import { flat } from './terrain.ts'

let probe = (
  run: Parameters<typeof controlsProbe<ReturnType<typeof listen>>>[1],
) => controlsProbe(listen, run)
let ground = flat(5)

test('left touch walks right while right touch orbits', () => {
  probe((p) => {
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
    let body: Body = {
      x: 20,
      y: 5,
      z: 20,
      vy: 0,
      yaw: Math.PI,
      speed: 0,
      gait: 'idle',
    }
    let stepped = stride(
      ground,
      body,
      i.move,
      i.orbit[0],
      0.1,
      5,
      false,
      i.look,
      i.faceMove,
    )
    ok(stepped.x > body.x)
    assertAlmostEquals(stepped.yaw, Math.PI / 2 + i.orbit[0])
  })
})

test('Vale maps keys and screen actions to its verbs, with jump held', () => {
  probe((p) => {
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
      p.send('keydown', { code })
      equal(p.hands.read()[verb], true, code)
      equal(p.hands.read()[verb], false, code)
      p.send('keyup', { code })
    }
    p.send('keydown', { code: 'Space' })
    equal(p.hands.read().jump, true)
    equal(p.hands.read().jump, true)
    p.send('keyup', { code: 'Space' })
    equal(p.hands.read().jump, false)
    for (let slot of [1, 2, 3]) {
      p.send('keydown', { code: `Digit${slot}` })
      equal(p.hands.read().ability, slot)
      equal(p.hands.read().ability, 0)
      p.send('keyup', { code: `Digit${slot}` })
    }
    p.hands.press('ability2')
    equal(p.hands.read().ability, 2)
    equal(keysOf('strike'), ['KeyF', 'KeyJ'])
    equal(movement(['KeyW', 'ArrowLeft'], false).turn, -6)
    equal(movement(['KeyA'], true).move, [-1, 0])
  })
})

test('Vale maps pointer taps and cursor projection without owning controls state', () => {
  probe((p) => {
    p.hands.hideCursor()
    for (let [button, verb] of [[2, 'dodge'], [0, 'strike']] as const) {
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
    }
    p.send('pointermove', { clientX: 600, clientY: 450 })
    equal(p.hands.pointer(), cursor(600, 450, 800, 600, false))
    ok(p.changes.length > 0)
    ok(p.changes.every((b) => b.entity.eid == 'test-consumer:pilot-controls'))
  })
})

test('Vale maps gamepad bindings to its verbs and distinguishes held jump from edges', () => {
  probe((p) => {
    for (
      let [button, verb] of [
        [1, 'dodge'],
        [2, 'strike'],
        [3, 'talk'],
        [6, 'drink'],
        [9, 'snap'],
      ] as const
    ) {
      p.pads([pad([], [button])])
      equal(p.hands.read()[verb], true)
      equal(p.hands.read()[verb], false)
      p.pads([])
      p.hands.read()
    }
    for (let [button, slot] of [[4, 1], [5, 2], [7, 3]]) {
      p.pads([pad([], [button])])
      equal(p.hands.read().ability, slot)
      equal(p.hands.read().ability, 0)
      p.pads([])
      p.hands.read()
    }
    p.pads([pad([0, -1, 1, 0], [0])])
    let i = p.hands.read(0.25)
    equal(i.move, [0, 1])
    assertAlmostEquals(i.orbit[0], -0.75)
    equal(i.jump, true)
    equal(p.hands.read().jump, true)
    p.pads([])
    equal(p.hands.read().jump, false)
  })
})
