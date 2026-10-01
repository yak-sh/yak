// Mouse button gestures and the movement they ask of the hero.

import { test } from '@yaks/testing'
import { assertAlmostEquals, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { listen, lookDrag, mouseButtons, movement } from './input.ts'
import { type Body } from './sim.ts'
import { stride } from './stride.ts'
import { flat } from './terrain.ts'

test('solo mouse clicks act, while a drag does not', () => {
  for (let [button, action] of [[0, 'strike'], [2, 'dodge']] as const) {
    let mouse = mouseButtons()
    mouse.down(button)
    assertEquals(mouse.up(button), action)
    mouse.down(button)
    mouse.move(button == 0 ? 1 : 2, 9)
    assertEquals(mouse.up(button), undefined)
  }
})

test('either mouse chord walks and consumes both releases', () => {
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

test('mouse chord follows button state through pointer motion and cancel', () => {
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

test('arrow keys turn in either A/D mode and still allow strafing', () => {
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

test('stick directions move in screen space without steering', () => {
  let sticks: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]
  for (let stick of sticks) {
    assertEquals(movement([], false, stick), {
      move: stick,
      turn: 0,
      faceMove: true,
    })
  }
})

test('touch look and mouse look keep their own gesture', () => {
  assertEquals(lookDrag(0, 'touch', false), true)
  assertEquals(lookDrag(2, 'mouse', false), true)
  assertEquals(lookDrag(0, 'mouse', false), false)
  assertEquals(lookDrag(0, 'mouse', true), true)
  assertEquals(lookDrag(2, 'mouse', true), false)
})

test('left touch walks right while right touch orbits', () => {
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

let mouseProbe = (
  run: (p: {
    hands: ReturnType<typeof listen>
    send: (
      type: string,
      button?: number,
      buttons?: number,
      pointerType?: string,
    ) => void
    lock: () => void
    keys: Map<string, string>
    requests: () => number
    locked: () => boolean
  }) => void,
) => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let events = new window.EventTarget()
  let keys = new Map<string, string>()
  let values = {
    document,
    innerWidth: 800,
    addEventListener: events.addEventListener.bind(events),
    localStorage: {
      getItem: (key: string) => keys.get(key) ?? null,
      setItem: (key: string, value: string) => keys.set(key, value),
    },
  }
  let before = Object.fromEntries(
    Object.keys(values).map((
      key,
    ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  for (let [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  try {
    let stage = document.createElement('div')
    let requests = 0
    Object.assign(stage, {
      setPointerCapture: () => {
        if (document.pointerLockElement) {
          throw new DOMException('A pointer is locked', 'InvalidStateError')
        }
      },
      hasPointerCapture: () => false,
      requestPointerLock: () => {
        requests++
      },
    })
    Object.assign(document, {
      pointerLockElement: null,
      exitPointerLock: () => {
        Object.assign(document, { pointerLockElement: null })
        document.dispatchEvent(new window.Event('pointerlockchange'))
      },
    })
    let hands = listen(stage, document.createElement('div'), () => false)
    run({
      hands,
      keys,
      requests: () => requests,
      locked: () => document.pointerLockElement == stage,
      lock: () => {
        Object.assign(document, { pointerLockElement: stage })
        document.dispatchEvent(new window.Event('pointerlockchange'))
      },
      send: (
        type,
        button = 0,
        buttons = button == 0 ? 1 : 2,
        pointerType = 'mouse',
      ) => {
        let e = new window.Event(type)
        Object.assign(e, {
          pointerId: pointerType == 'mouse' ? 1 : 2,
          pointerType,
          button,
          buttons,
          clientX: pointerType == 'mouse' ? 400 : 100,
          clientY: 300,
          movementX: 10,
          movementY: 5,
          code: 'Escape',
        })
        if (type == 'mouseup' || type == 'keydown') events.dispatchEvent(e)
        else if (type == 'pointerlockchange') document.exitPointerLock()
        else stage.dispatchEvent(e)
      },
    })
  } finally {
    for (let [key, descriptor] of Object.entries(before)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('steering and orbit use locked deltas or captured drags in either swap', () => {
  for (let hide of [true, false]) {
    for (let swap of [true, false]) {
      for (let button of [0, 2]) {
        mouseProbe((p) => {
          assertEquals(p.hands.hidesCursor(), true)
          if (!hide) p.hands.hideCursor()
          if (swap) p.hands.swap()
          p.send('pointerdown', button)
          assertEquals(p.requests(), hide ? 1 : 0)
          if (hide) {
            p.lock()
            // Gaining lock drops capture but must keep the gesture.
            p.send('lostpointercapture', button)
            p.send('mousemove', button)
          } else p.send('pointermove', button)
          let intent = p.hands.read()
          assertAlmostEquals(intent.orbit[0], -0.06)
          assertAlmostEquals(intent.orbit[1], 0.03)
          assertEquals(intent.look, lookDrag(button, 'mouse', swap))
          p.send('pointerup', button, 0)
          p.send('mouseup', button, 0)
          assertEquals(p.locked(), false)
          assertEquals(p.hands.read().look, false)
        })
      }
    }
  }
})

test('locked mouse chord stays locked until both buttons release', () => {
  mouseProbe((p) => {
    p.send('pointerdown')
    p.lock()
    p.send('mousedown', 2, 3)
    p.send('mousemove', 2, 3)
    assertEquals(p.hands.read().move, [0, 1])
    p.send('mouseup', 0, 2)
    assertEquals(p.locked(), true)
    p.send('mouseup', 2, 0)
    assertEquals(p.locked(), false)
    let intent = p.hands.read()
    assertEquals(intent.move, [0, 0])
    assertEquals(intent.strike, false)
    assertEquals(intent.dodge, false)
  })
})

test('escape and native unlock cancel the mouse without a stuck gesture', () => {
  for (let type of ['keydown', 'pointerlockchange']) {
    mouseProbe((p) => {
      p.send('pointerdown', 2)
      p.lock()
      p.send(type)
      assertEquals(p.locked(), false)
      p.send('mousemove', 2)
      p.send('mouseup', 2, 0)
      let intent = p.hands.read()
      assertEquals(intent.orbit, [0, 0])
      assertEquals(intent.look, false)
      assertEquals(intent.dodge, false)
    })
  }
})

test('a late pointer lock grant after release immediately unlocks', () => {
  mouseProbe((p) => {
    p.send('pointerdown')
    p.send('pointerup', 0, 0)
    p.send('mouseup', 0, 0)
    p.lock()
    assertEquals(p.locked(), false)
  })
})

test('hide cursor preference is stored and restored', () => {
  mouseProbe((p) => {
    p.hands.hideCursor()
    assertEquals(p.keys.get('mossvale.drag.hideCursor'), '0')
    let stage = document.createElement('div')
    let again = listen(stage, document.createElement('div'), () => false)
    assertEquals(again.hidesCursor(), false)
    again.hideCursor()
    assertEquals(p.keys.get('mossvale.drag.hideCursor'), '1')
  })
})

test('a second button while locked needs neither capture nor another lock', () => {
  mouseProbe((p) => {
    p.send('pointerdown')
    p.lock()
    p.send('pointerdown', 2, 3)
    assertEquals(p.requests(), 1)
    assertEquals(p.hands.read().move, [0, 1])
  })
})

test('touch input still starts while a mouse drag is pointer locked', () => {
  mouseProbe((p) => {
    p.send('pointerdown')
    p.lock()
    p.send('pointerdown', 0, 1, 'touch')
    assertEquals(p.locked(), true)
    assertEquals(p.requests(), 1)
  })
})
