// Mouse button gestures and the movement they ask of the hero.

import { assertAlmostEquals, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { listen, lookDrag, mouseButtons, movement } from './input.ts'
import { type Body } from './sim.ts'
import { stride } from './stride.ts'
import { flat } from './terrain.ts'

Deno.test('solo mouse clicks act, while a drag does not', () => {
  for (let [button, action] of [[0, 'strike'], [2, 'dodge']] as const) {
    let mouse = mouseButtons()
    mouse.down(button)
    assertEquals(mouse.up(button), action)
    mouse.down(button)
    mouse.move(button == 0 ? 1 : 2, 9)
    assertEquals(mouse.up(button), undefined)
  }
})

Deno.test('either mouse chord walks and consumes both releases', () => {
  for (let first of [0, 2]) {
    for (let released of [0, 2]) {
      let mouse = mouseButtons()
      mouse.down(first)
      mouse.down(first == 0 ? 2 : 0)
      assertEquals(mouse.walk(), true)
      assertEquals(movement([], false, undefined, mouse.walk()), {
        move: [0, 1],
        turn: 0,
        faceMove: false,
      })
      assertEquals(mouse.up(released), undefined)
      assertEquals(mouse.walk(), false)
      assertEquals(mouse.up(released == 0 ? 2 : 0), undefined)
      assertEquals(mouse.chorded(), true)
    }
  }
})

Deno.test('mouse chord follows button state through pointer motion and cancel', () => {
  let mouse = mouseButtons()
  mouse.down(0)
  mouse.move(3, 12) // the second press need not produce a pointerdown
  assertEquals(mouse.walk(), true)
  assertEquals(movement(['KeyA'], false, undefined, mouse.walk()), {
    move: [0, 1],
    turn: -6,
    faceMove: false,
  })
  mouse.move(2, 1) // releasing the first button stops walking
  assertEquals(mouse.walk(), false)
  assertEquals(mouse.up(2), undefined)
  mouse.down(0)
  mouse.down(2)
  mouse.cancel()
  assertEquals(mouse.walk(), false)
  assertEquals(mouse.up(0), undefined)
  assertEquals(mouse.up(2), undefined)
})

Deno.test('arrow keys turn in either A/D mode and still allow strafing', () => {
  for (let strafe of [false, true]) {
    for (
      let [code, turn] of [
        ['ArrowLeft', -6],
        ['ArrowRight', 6],
      ] as const
    ) {
      assertEquals(movement([code], strafe).turn, turn)
      assertEquals(movement([code, 'KeyW'], strafe).turn, turn)
      assertEquals(movement([code], strafe).move, [0, 0])
    }
  }
  assertEquals(movement(['KeyA'], true).move, [-1, 0])
  assertEquals(movement(['ArrowRight', 'KeyA'], true), {
    move: [-1, 0],
    turn: 6,
    faceMove: false,
  })
  assertEquals(movement(['ArrowLeft'], true, undefined, true), {
    move: [0, 1],
    turn: -6,
    faceMove: false,
  })
})

Deno.test('stick directions move in screen space without steering', () => {
  let sticks: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]
  for (let stick of sticks) {
    assertEquals(movement([], false, stick), {
      move: stick,
      turn: 0,
      faceMove: true,
    })
  }
})

Deno.test('touch look and mouse look keep their own gesture', () => {
  assertEquals(lookDrag(0, 'touch', false), true)
  assertEquals(lookDrag(2, 'mouse', false), true)
  assertEquals(lookDrag(0, 'mouse', false), false)
  assertEquals(lookDrag(0, 'mouse', true), true)
  assertEquals(lookDrag(2, 'mouse', true), false)
})

Deno.test('left touch walks right while right touch orbits', () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let before = Object.fromEntries(
    ['document', 'innerWidth', 'addEventListener'].map((
      key,
    ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  for (
    let [key, value] of Object.entries({
      document,
      innerWidth: 800,
      addEventListener: () => {},
    })
  ) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  try {
    let stage = document.createElement('div')
    let glass = document.createElement('div')
    Object.assign(stage, { setPointerCapture: () => {} })
    let hands = listen(stage, glass, () => false)
    let pointer = (type: string, id: number, x: number, y: number) => {
      let e = new window.Event(type)
      Object.assign(e, {
        pointerType: 'touch',
        pointerId: id,
        clientX: x,
        clientY: y,
      })
      stage.dispatchEvent(e)
    }
    pointer('pointerdown', 1, 100, 100)
    pointer('pointermove', 1, 156, 100)
    pointer('pointerdown', 2, 700, 100)
    pointer('pointermove', 2, 740, 100)
    let i = hands.read()
    assertEquals(i.move, [1, 0])
    assertEquals(i.faceMove, true)
    assertEquals(i.turn, 0)
    assertEquals(i.look, true)
    assertEquals(i.orbit[0] < 0, true)
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
      flat(5),
      body,
      i.move,
      i.orbit[0],
      0.1,
      5,
      false,
      i.look,
      i.faceMove,
    )
    assertEquals(stepped.x > body.x, true)
    assertAlmostEquals(stepped.yaw, Math.PI / 2 + i.orbit[0])
  } finally {
    for (let [key, descriptor] of Object.entries(before)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
