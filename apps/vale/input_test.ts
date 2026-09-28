// Mouse button gestures and the movement they ask of the hero.

import { assertEquals } from '@std/assert'
import { mouseButtons, movement } from './input.ts'

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
        steer: undefined,
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
  assertEquals(
    movement(['KeyA'], false, undefined, mouse.walk()).steer,
    { turn: -6, forward: 1 },
  )
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
      assertEquals(movement([code], strafe).steer, { turn, forward: 0 })
      assertEquals(movement([code, 'KeyW'], strafe).steer?.turn, turn)
      assertEquals(movement([code], strafe).move, [0, 0])
    }
  }
  assertEquals(movement(['KeyA'], true).steer, undefined)
  assertEquals(movement(['ArrowRight', 'KeyA'], true).steer, {
    turn: 6,
    forward: 0,
    side: -1,
  })
  assertEquals(movement(['ArrowLeft'], true, undefined, true).steer, {
    turn: -6,
    forward: 1,
  })
})
