// Reusable controls behavior with consumer-owned state and explicit bindings.
import { equal, ok, test } from '@yaks/testing'
import { assertAlmostEquals } from '@std/assert'
import {
  initial,
  listen,
  lookDrag,
  type MotionBindings,
  mouseButtons,
  movement as axes,
} from './controls.ts'
import { controlsFixture, controlsProbe, pad } from './controls_test_support.ts'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { docs } from './vocab.ts'
import type { ControlsBundle, Hands } from './controls.ts'

let bindings: MotionBindings = {
  axes: { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] },
  turns: { ArrowLeft: -1, ArrowRight: 1 },
}
let movement = (
  held: Iterable<string>,
  strafe: boolean,
  stick?: [number, number],
  walk = false,
) => axes(held, strafe, stick, walk, bindings)
let probeTest = (
  name: string,
  run: Parameters<typeof controlsProbe<ReturnType<typeof listen>>>[1],
  options: { touchStick?: boolean } = {},
) =>
  test(
    name,
    controlsFixture(
      (stage, glass, busy, state) =>
        listen(stage, glass, busy, {
          ...state,
          ...bindings,
          ...options,
          keys: { KeyF: 'activate', Space: 'hop' },
          tap: { 0: 'activate', 2: 'evade' },
          cursor: (x, y, locked) => locked ? [0, 0] : [x / 800, y / 600],
          gamepad: {
            move: [0, 1],
            look: [2, 3],
            buttons: { 0: 'hop', 2: 'activate' },
            deadzone: 0.2,
            lookRate: 4,
          },
        }),
    ).bind(null, run),
  )
type Probe = Parameters<Parameters<typeof probeTest>[1]>[0]
let mouseTest = (
  name: string,
  run: (p: {
    hands: ReturnType<typeof listen>
    send: (
      type: string,
      button?: number,
      buttons?: number,
      pointerType?: string,
    ) => void
    lock: () => void
    requests: () => number
    locked: () => boolean
  }) => void,
) =>
  probeTest(name, (p) =>
    run({
      ...p,
      send: (
        type,
        button = 0,
        buttons = button == 0 ? 1 : 2,
        pointerType = 'mouse',
      ) => {
        p.send(type, {
          button,
          buttons,
          pointerType,
          pointerId: pointerType == 'mouse' ? 1 : 2,
          clientX: pointerType == 'mouse' ? 400 : 100,
          code: 'Escape',
        })
      },
    }))

test('solo mouse clicks act, while a drag does not', () => {
  for (let button of [0, 2]) {
    let mouse = mouseButtons()
    mouse.down(button)
    equal(mouse.up(button), button)
    mouse.down(button)
    mouse.move(button == 0 ? 1 : 2, 9)
    equal(mouse.up(button), undefined)
  }
})

test('either mouse chord walks and consumes both releases', () => {
  for (let first of [0, 2]) {
    for (let released of [0, 2]) {
      let mouse = mouseButtons()
      mouse.down(first)
      mouse.down(first == 0 ? 2 : 0)
      equal(mouse.walk(), true)
      equal(movement([], false, undefined, mouse.walk()), {
        move: [0, 1],
        turn: 0,
        faceMove: false,
      })
      equal(mouse.up(released), undefined)
      equal(mouse.walk(), false)
      equal(mouse.up(released == 0 ? 2 : 0), undefined)
      equal(mouse.chorded(), true)
    }
  }
})

test('mouse chord follows button state through pointer motion and cancel', () => {
  let mouse = mouseButtons()
  mouse.down(0)
  mouse.move(3, 12) // the second press need not produce a pointerdown
  equal(mouse.walk(), true)
  equal(movement(['KeyA'], false, undefined, mouse.walk()), {
    move: [0, 1],
    turn: -6,
    faceMove: false,
  })
  mouse.move(2, 1) // releasing the first button stops walking
  equal(mouse.walk(), false)
  equal(mouse.up(2), undefined)
  mouse.down(0)
  mouse.down(2)
  mouse.cancel()
  equal(mouse.walk(), false)
  equal(mouse.up(0), undefined)
  equal(mouse.up(2), undefined)
})

test('arrow keys turn in either A/D mode and still allow strafing', () => {
  for (let strafe of [false, true]) {
    for (
      let [code, turn] of [
        ['ArrowLeft', -6],
        ['ArrowRight', 6],
      ] as const
    ) {
      equal(movement([code], strafe).turn, turn)
      equal(movement([code, 'KeyW'], strafe).turn, turn)
      equal(movement([code], strafe).move, [0, 0])
    }
  }
  equal(movement(['KeyA'], true).move, [-1, 0])
  equal(movement(['ArrowRight', 'KeyA'], true), {
    move: [-1, 0],
    turn: 6,
    faceMove: false,
  })
  equal(movement(['ArrowLeft'], true, undefined, true), {
    move: [0, 1],
    turn: -6,
    faceMove: false,
  })
})

test('stick directions move in screen space without steering', () => {
  let sticks: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]
  for (let stick of sticks) {
    equal(movement([], false, stick), {
      move: stick,
      turn: 0,
      faceMove: true,
    })
  }
})

test('touch look and mouse look keep their own gesture', () => {
  equal(lookDrag(0, 'touch', false), true)
  equal(lookDrag(2, 'mouse', false), true)
  equal(lookDrag(0, 'mouse', false), false)
  equal(lookDrag(0, 'mouse', true), true)
  equal(lookDrag(2, 'mouse', true), false)
})

for (let hide of [true, false]) {
  for (let swap of [true, false]) {
    for (let button of [0, 2]) {
      mouseTest(
        `${hide ? 'Locked deltas' : 'Captured drag'} steer and orbit with ${
          swap ? 'swapped' : 'default'
        } button ${button}`,
        (p) => {
          equal(p.hands.hidesCursor(), true)
          if (!hide) p.hands.hideCursor()
          if (swap) p.hands.swap()
          p.send('pointerdown', button)
          equal(p.requests(), hide ? 1 : 0)
          if (hide) {
            p.lock()
            // Gaining lock drops capture but must keep the gesture.
            p.send('lostpointercapture', button)
            p.send('mousemove', button)
          } else p.send('pointermove', button)
          let intent = p.hands.read()
          assertAlmostEquals(intent.orbit[0], -0.06)
          assertAlmostEquals(intent.orbit[1], 0.03)
          equal(intent.look, lookDrag(button, 'mouse', swap))
          p.send('pointerup', button, 0)
          p.send('mouseup', button, 0)
          equal(p.locked(), false)
          equal(p.hands.read().look, false)
        },
      )
    }
  }
}

mouseTest('locked mouse chord stays locked until both buttons release', (p) => {
  p.send('pointerdown')
  p.lock()
  p.send('mousedown', 2, 3)
  p.send('mousemove', 2, 3)
  equal(p.hands.read().move, [0, 1])
  p.send('mouseup', 0, 2)
  equal(p.locked(), true)
  p.send('mouseup', 2, 0)
  equal(p.locked(), false)
  let intent = p.hands.read()
  equal(intent.move, [0, 0])
  equal(intent.actions.includes('activate'), false)
  equal(intent.actions.includes('evade'), false)
})

for (let type of ['keydown', 'pointerlockchange']) {
  mouseTest(
    `${
      type == 'keydown' ? 'Escape' : 'Native unlock'
    } cancels the mouse without a stuck gesture`,
    (p) => {
      p.send('pointerdown', 2)
      p.lock()
      p.send(type)
      equal(p.locked(), false)
      p.send('mousemove', 2)
      p.send('mouseup', 2, 0)
      let intent = p.hands.read()
      equal(intent.orbit, [0, 0])
      equal(intent.look, false)
      equal(intent.actions.includes('evade'), false)
    },
  )
}

mouseTest(
  'a late pointer lock grant after release immediately unlocks',
  (p) => {
    p.send('pointerdown')
    p.send('pointerup', 0, 0)
    p.send('mouseup', 0, 0)
    p.lock()
    equal(p.locked(), false)
  },
)

mouseTest(
  'a second button while locked needs neither capture nor another lock',
  (p) => {
    p.send('pointerdown')
    p.lock()
    p.send('pointerdown', 2, 3)
    equal(p.requests(), 1)
    equal(p.hands.read().move, [0, 1])
  },
)

mouseTest(
  'touch input still starts while a mouse drag is pointer locked',
  (p) => {
    p.send('pointerdown')
    p.lock()
    p.send('pointerdown', 0, 1, 'touch')
    equal(p.locked(), true)
    equal(p.requests(), 1)
  },
)

probeTest(
  'touch taps can pick left-hand sites with the movement stick disabled',
  (p) => {
    p.send('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 150 })
    equal(p.row().Controls?.stick, null)
    p.send('pointerup', {
      pointerType: 'touch',
      clientX: 101,
      clientY: 150,
      buttons: 0,
    })
    let intent = p.hands.read()
    equal(intent.actions, ['activate'])
    equal(intent.pick, [0.125, 0.25])
    equal(intent.move, [0, 0])
    equal(p.hands.read().pick, undefined)
  },
  { touchStick: false },
)

probeTest(
  'left-hand touch drags still look without movement or a tap when the stick is disabled',
  (p) => {
    p.send('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 150 })
    p.send('pointermove', { pointerType: 'touch', clientX: 120, clientY: 160 })
    let intent = p.hands.read()
    equal(intent.move, [0, 0])
    equal(intent.look, true)
    assertAlmostEquals(intent.orbit[0], -0.18)
    assertAlmostEquals(intent.orbit[1], 0.09)
    p.send('pointerup', {
      pointerType: 'touch',
      clientX: 120,
      clientY: 160,
      buttons: 0,
    })
    let released = p.hands.read()
    equal(released.actions, [])
    equal(released.pick, undefined)
  },
  { touchStick: false },
)

// A touch probe: `touch(type, id, x, y)` sends one finger's pointer event.
let touchTest = (
  name: string,
  run: (
    p: Probe,
    touch: (type: string, id: number, x: number, y: number) => void,
  ) => void,
) =>
  probeTest(name, (p) =>
    run(p, (type, id, x, y) => {
      p.send(type, {
        pointerType: 'touch',
        pointerId: id,
        clientX: x,
        clientY: y,
      })
    }))

touchTest('touch stick and look gestures coexist', (p, touch) => {
  touch('pointerdown', 1, 100, 100)
  touch('pointermove', 1, 212, 100) // clamped at a full stick, not two units
  touch('pointerdown', 2, 700, 100)
  touch('pointermove', 2, 740, 120)
  let i = p.hands.read()
  equal(i.move, [1, 0])
  equal(i.faceMove, true)
  equal(i.turn, 0)
  equal(i.look, true)
  assertAlmostEquals(i.orbit[0], -0.36)
  assertAlmostEquals(i.orbit[1], 0.18)
})

touchTest(
  'a released touch look is no tap and leaves the stick',
  (p, touch) => {
    touch('pointerdown', 1, 100, 100)
    touch('pointermove', 1, 212, 100)
    touch('pointerdown', 2, 700, 100)
    touch('pointermove', 2, 740, 120)
    touch('pointerup', 2, 740, 120)
    let i = p.hands.read()
    equal(i.actions, [])
    equal(i.move, [1, 0])
  },
)

for (let end of ['pointercancel', 'lostpointercapture']) {
  touchTest(`${end} releases the touch stick`, (p, touch) => {
    touch('pointerdown', 1, 100, 100)
    touch('pointermove', 1, 100, 44)
    touch(end, 1, 100, 44)
    let i = p.hands.read()
    equal(i.move, [0, 0])
    equal(i.look, false)
  })
}

touchTest('the touch stick is drawn under the thumb and rests on release', (
  p,
  touch,
) => {
  let face = () => p.glass.querySelector('.Stick')!
  let knob = () => p.glass.querySelector('.Stick_Knob')!
  touch('pointerdown', 1, 100, 120)
  touch('pointermove', 1, 130, 110)
  ok(face().getAttribute('style')?.includes('translate(100px, 120px)'))
  ok(knob().getAttribute('style')?.includes('translate(30px, -10px)'))
  touch('pointerup', 1, 130, 110)
  ok(face().classList.contains('Stick-rest'))
})

probeTest('settings round trip through the consumer-named entity', (p) => {
  equal(p.changes, [])
  p.hands.swap()
  p.hands.strafe()
  p.hands.hideCursor()
  equal(p.row().Controls?.swapped, true)
  equal(p.row().Controls?.strafe, true)
  equal(p.row().Controls?.hide_cursor, false)
  ok(p.changes.every((b) => b.entity.eid == 'test-consumer:pilot-controls'))
})

probeTest(
  'a replaced consumer row drives settings and gestures',
  (p) => {
    let replacement = {
      entity: { eid: 'another-consumer:controls' },
      Controls: {
        swapped: true,
        strafe: true,
        hide_cursor: false,
        held: ['KeyW'],
        pressed: ['external-action'],
      },
    }
    equal(p.hands.swapped(), false)
    p.replace(replacement)
    equal(p.hands.swapped(), true)
    equal(p.hands.strafes(), true)
    equal(p.hands.hidesCursor(), false)
    equal(p.hands.read().actions, ['external-action'])
    equal(p.hands.read().move, [0, 1])
    equal(p.changes.at(-1)?.entity, replacement.entity)
    equal(p.row().Controls?.pressed, [])
  },
)

probeTest('keys use supplied bindings and deduplicate edges', (p) => {
  equal(p.send('keydown', { code: 'KeyW' }).defaultPrevented, true)
  equal(p.send('keydown', { code: 'KeyF' }).defaultPrevented, true)
  p.send('keydown', { code: 'KeyF', repeat: true })
  let first = p.hands.read()
  equal(first.move, [0, 1])
  equal(first.actions, ['activate'])
  equal(first.held, ['activate'])
  let next = p.hands.read()
  equal(next.actions, [])
  equal(next.held, ['activate'])
})

probeTest('released keys release held actions and movement', (p) => {
  for (let type of ['keydown', 'keyup']) {
    p.send(type, { code: 'KeyF' })
    p.send(type, { code: 'KeyW' })
  }
  let i = p.hands.read()
  equal(i.held, [])
  equal(i.move, [0, 0])
})

probeTest('modified keys and keys while busy emit nothing', (p) => {
  for (let fields of [{ metaKey: true }, { ctrlKey: true }]) {
    p.send('keydown', { code: 'KeyF', ...fields })
    equal(p.hands.read().actions, [])
  }
  p.busy(true)
  p.send('keydown', { code: 'KeyF' })
  equal(p.hands.read().actions, [])
})

probeTest('arrow keys turn by the supplied turn bindings', (p) => {
  p.send('keydown', { code: 'ArrowLeft' })
  equal(p.hands.read().turn, -6)
})

probeTest(
  'read consumes screen presses, wheel and orbit deltas exactly once',
  (p) => {
    p.hands.press('screen-action')
    p.hands.press('screen-action')
    p.send('wheel', { deltaY: 20 })
    p.send('wheel', { deltaY: 30 })
    p.send('pointerdown', { button: 2, buttons: 2 })
    p.send('pointermove', { button: 2, buttons: 2 })
    let first = p.hands.read()
    equal(first.actions, ['screen-action'])
    equal(first.zoom, 2)
    assertAlmostEquals(first.orbit[0], -0.06)
    let next = p.hands.read()
    equal(next.actions, [])
    equal(next.zoom, 0)
    equal(next.orbit, [0, 0])
  },
)

probeTest(
  'cursor projection receives current position and pointer-lock status',
  (p) => {
    p.send('pointermove', { clientX: 200, clientY: 150 })
    equal(p.hands.pointer(), [0.25, 0.25])
    p.send('pointerdown')
    p.lock()
    equal(p.hands.pointer(), [0, 0])
  },
)

probeTest(
  'dispose removes all browser listeners, unlocks, releases capture and unmounts',
  (p) => {
    p.send('pointerdown', { button: 2, buttons: 2 })
    p.lock()
    p.send('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100 })
    p.send('keydown', { code: 'KeyF' })
    ok(p.listeners() > 0)
    ok(p.glass.childNodes.length > 0)
    p.dispose()
    equal(p.listeners(), 0)
    equal(p.locked(), false)
    equal(p.captures.size, 0)
    equal(p.glass.childNodes.length, 0)
    equal(p.row().Controls?.held, [])
    equal(p.row().Controls?.pressed, [])
    equal(p.row().Controls?.drags, {})
    equal(p.row().Controls?.stick, null)
  },
)

probeTest('events after dispose change nothing', (p) => {
  p.dispose()
  let row = p.row(), changes = p.changes.length
  p.send('keydown', { code: 'KeyF' })
  p.send('wheel', { deltaY: 1 })
  p.send('pointerdown')
  p.send('blur')
  equal(p.row(), row)
  equal(p.changes.length, changes)
})

probeTest('dispose releases captured touch without pointer lock', (p) => {
  p.send('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 100 })
  equal([...p.captures], [7])
  p.dispose()
  equal(p.captures.size, 0)
  equal(p.listeners(), 0)
})

probeTest(
  'gamepad API is polled per read; presses have edges and remain held',
  (p) => {
    equal(p.polls(), 0)
    p.pads([null, pad([], [0, 2])])
    let first = p.hands.read()
    equal(first.actions, ['hop', 'activate'])
    equal(first.held, ['hop', 'activate'])
    equal(p.polls(), 1)
    equal(p.row().Controls?.pad, ['hop', 'activate'])
    equal(p.hands.read().actions, [])
    equal(p.hands.read().held, ['hop', 'activate'])
    p.pads([pad()])
    equal(p.hands.read().held, [])
    p.pads([pad([], [2])])
    equal(p.hands.read().actions, ['activate'])
  },
)

probeTest(
  'gamepad disconnects and sparse lists release movement, look and buttons',
  (p) => {
    p.pads([null, pad([1, -1, 1, 0], [2])])
    let first = p.hands.read()
    assertAlmostEquals(Math.hypot(...first.move), 1)
    equal(first.look, true)
    equal(first.held, ['activate'])
    p.pads([null, pad([1, -1, 1, 0], [2], false)])
    let gone = p.hands.read()
    equal(gone.move, [0, 0])
    equal(gone.orbit, [0, 0])
    equal(gone.look, false)
    equal(gone.actions, [])
    equal(gone.held, [])
    p.pads([])
    equal(p.hands.read().held, [])
    p.pads([null, pad([], [2])])
    equal(p.hands.read().actions, ['activate'])
  },
)

probeTest(
  'gamepad radial deadzone rescales movement and integrates look using dt',
  (p) => {
    p.pads([pad([0.12, -0.12, 0.12, -0.12])])
    let quiet = p.hands.read()
    equal(quiet.move, [0, 0])
    equal(quiet.orbit, [0, 0])
    equal(quiet.look, false)
    p.pads([pad([0.36, -0.48, 0.6, -0.8])])
    let i = p.hands.read(0.25)
    assertAlmostEquals(i.move[0], 0.3)
    assertAlmostEquals(i.move[1], 0.4)
    assertAlmostEquals(i.orbit[0], -0.6)
    assertAlmostEquals(i.orbit[1], -0.8)
    equal(i.faceMove, true)
    equal(i.look, true)
    let next = p.hands.read(0.125)
    assertAlmostEquals(next.orbit[0], i.orbit[0] / 2)
    assertAlmostEquals(next.orbit[1], i.orbit[1] / 2)
    // Multiple controllers combine without exceeding a unit movement vector.
    p.pads([pad([1, 0]), pad([0, -1])])
    assertAlmostEquals(Math.hypot(...p.hands.read().move), 1)
  },
)

// What a read gives while busy or blurred: no polling and no input at all.
let quiet = (p: Probe) => {
  let polls = p.polls(), i = p.hands.read()
  equal(p.polls(), polls)
  equal(i.actions, [])
  equal(i.held, [])
  equal(i.move, [0, 0])
  equal(i.orbit, [0, 0])
  equal(i.look, false)
}

probeTest(
  'busy suppresses gamepad polling, held actions, movement and look',
  (p) => {
    p.pads([pad([1, 0, 1, 0], [2])])
    equal(p.hands.read().actions, ['activate'])
    p.busy(true)
    quiet(p)
    p.busy(false)
    equal(p.hands.read().actions, ['activate'])
  },
)

probeTest(
  'blur unlocks and suppresses every input until focus returns',
  (p) => {
    p.pads([pad([1, 0, 1, 0], [2])])
    p.send('keydown', { code: 'KeyF' })
    p.send('pointerdown')
    p.lock()
    p.send('blur')
    equal(p.locked(), false)
    equal(p.row().Controls?.focused, false)
    quiet(p)
    p.send('focus')
    equal(p.hands.read().actions, ['activate'])
  },
)

probeTest(
  'gamepad permission refusal is no input and recovers on the next read',
  (p) => {
    p.refusePads(new DOMException('permission denied', 'SecurityError'))
    equal(p.hands.read().held, [])
    p.refusePads(undefined)
    p.pads([pad([], [2])])
    equal(p.hands.read().actions, ['activate'])
  },
)

for (let source of ['key', 'touch', 'pad']) {
  probeTest(
    `${source} emits the configured action once and reports held state`,
    (p) => {
      if (source == 'key') p.send('keydown', { code: 'KeyF' })
      if (source == 'touch') {
        p.send('pointerdown', { pointerType: 'touch', clientX: 700 })
        p.send('pointerup', { pointerType: 'touch', clientX: 700, buttons: 0 })
      }
      if (source == 'pad') p.pads([pad([], [2])])
      let i = p.hands.read()
      equal(i.actions, ['activate'], source)
      equal(p.hands.read().actions, [], source)
      equal(i.held, source == 'touch' ? [] : ['activate'])
    },
  )
}

for (let source of ['key', 'touch', 'pad']) {
  probeTest(`${source} movement uses normalized forward axes`, (p) => {
    if (source == 'key') p.send('keydown', { code: 'KeyW' })
    if (source == 'touch') {
      p.send('pointerdown', {
        pointerType: 'touch',
        clientX: 100,
        clientY: 100,
      })
      p.send('pointermove', {
        pointerType: 'touch',
        clientX: 100,
        clientY: 44,
      })
    }
    if (source == 'pad') p.pads([pad([0, -1])])
    equal(p.hands.read().move, [0, 1], source)
  })
}

probeTest(
  'primary mouse tap emits its bound action and preserves the press pick',
  (p) => {
    p.hands.hideCursor()
    p.send('pointerdown', { clientX: 200, clientY: 150 })
    p.send('pointerup', { clientX: 202, clientY: 152, buttons: 0 })
    p.send('mouseup', { buttons: 0 })
    let i = p.hands.read()
    equal(i.actions, ['activate'])
    equal(i.pick, [0.25, 0.25])
    equal(p.hands.read().pick, undefined)
  },
)

probeTest(
  'reattaching controls restores preferences from consumer state',
  (p) => {
    p.hands.hideCursor()
    p.hands.swap()
    p.hands.strafe()
    p.dispose()
    let again = listen(p.stage, p.glass, () => false, {
      ...bindings,
      keys: {},
      cursor: (x, y) => [x, y],
      get: p.row,
      onChange: p.replace,
    })
    try {
      equal(again.hidesCursor(), false)
      equal(again.swapped(), true)
      equal(again.strafes(), true)
      again.hideCursor()
      equal(p.row().Controls?.hide_cursor, true)
    } finally {
      again.dispose()
    }
    equal(p.listeners(), 0)
  },
)

// One client graph for the file, as a page holds one, built and seeded before
// any case runs; each case keeps to an entity of its own, a whole Controls row
// as controls writes one. Event handling, graph writes and reads stay measured.
let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
await front.ready
let graphTest = (
  name: string,
  seed: ControlsBundle['Controls'],
  run: (p: Probe, graph: {
    row: () => ControlsBundle
    patch: (controls: ControlsBundle['Controls']) => void
    attach: (
      stage: HTMLElement,
      glass: HTMLElement,
      busy: () => boolean,
    ) => Hands
  }) => void,
  { remount = false } = {},
) => {
  let eid = `test-client:${name}`
  let patch = (controls: ControlsBundle['Controls']) => {
    front.mutate([{ entity: { eid }, Controls: controls }])
  }
  patch({ ...initial(), ...seed })
  let row = (): ControlsBundle => ({
    entity: { eid },
    Controls: front.ent(eid)?.Controls as ControlsBundle['Controls'],
  })
  let attach = (stage: HTMLElement, glass: HTMLElement, busy: () => boolean) =>
    listen(stage, glass, busy, {
      ...bindings,
      keys: { KeyF: 'activate' },
      cursor: (x, y) => [x, y],
      get: row,
      onChange: (bundle) => patch(bundle.Controls),
    })
  let mount = remount
    ? (stage: HTMLElement, glass: HTMLElement, busy: () => boolean) => {
      attach(stage, glass, busy).dispose()
      return attach(stage, glass, busy)
    }
    : attach
  test(
    `client graph ${name}`,
    controlsFixture(mount).bind(null, (p) => run(p, { row, patch, attach })),
  )
}

graphTest('keeps a held key and its edge on the consumer entity', {}, (
  p,
  g,
) => {
  p.send('keydown', { code: 'KeyF' })
  equal(g.row().Controls?.held, ['KeyF'])
  equal(g.row().Controls?.pressed, ['activate'])
})

for (
  let [toggle, reads, prop] of [
    ['swap', 'swapped', 'swapped'],
    ['strafe', 'strafes', 'strafe'],
    ['hideCursor', 'hidesCursor', 'hide_cursor'],
  ] as const
) {
  graphTest(`keeps the ${prop} preference on the consumer entity`, {}, (
    p,
    g,
  ) => {
    let was = p.hands[reads]()
    p.hands[toggle]()
    equal(g.row().Controls?.[prop], !was)
    equal(p.hands[reads](), !was)
  })
}

graphTest('reads edges and held actions back from the consumer entity', {
  held: ['KeyW', 'KeyF'],
  pressed: ['activate'],
}, (p) => {
  let i = p.hands.read()
  equal(i.move, [0, 1])
  equal(i.actions, ['activate'])
  equal(i.held, ['activate'])
  let next = p.hands.read()
  equal(next.actions, [])
  equal(next.held, ['activate'])
})

graphTest('keeps held input across a consumer preference patch', {
  held: ['KeyF'],
  swapped: true,
}, (p, g) => {
  equal(p.hands.swapped(), true)
  g.patch({ swapped: false })
  equal(p.hands.swapped(), false)
  equal(p.hands.read().held, ['activate'])
})

graphTest('keeps held input across a toggle until the key is released', {
  held: ['KeyF'],
}, (p) => {
  p.hands.swap()
  equal(p.hands.read().held, ['activate'])
  p.send('keyup', { code: 'KeyF' })
  equal(p.hands.read().held, [])
})

graphTest('remounts with the entity preferences and without old gestures', {
  hide_cursor: false,
  strafe: true,
  swapped: true,
  held: ['KeyF'],
  pressed: ['activate'],
}, (p, g) => {
  p.dispose()
  let again = g.attach(p.stage, p.glass, () => false)
  try {
    equal(again.hidesCursor(), false)
    equal(again.strafes(), true)
    equal(again.swapped(), true)
    let i = again.read()
    equal(i.held, [])
    equal(i.actions, [])
  } finally {
    again.dispose()
  }
  equal(p.listeners(), 0)
})

// The second mount is fixture work here; the measured case is its writing.
graphTest('remounted controls write keys to the same consumer entity', {}, (
  p,
  g,
) => {
  p.send('keydown', { code: 'KeyF' })
  equal(g.row().Controls?.held, ['KeyF'])
  equal(g.row().Controls?.pressed, ['activate'])
}, { remount: true })

probeTest(
  'unbound keys do not enter consumer held state and busy masks held verbs',
  (p) => {
    p.send('keydown', { code: 'KeyZ' })
    equal(p.row().Controls?.held ?? [], [])
    p.send('keydown', { code: 'KeyF' })
    equal(p.hands.read().held, ['activate'])
    p.busy(true)
    equal(p.hands.read().held, [])
    p.busy(false)
    equal(p.hands.read().held, ['activate'])
    p.send('keyup', { code: 'KeyF' })
    equal(p.hands.read().held, [])
  },
)
