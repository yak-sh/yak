// Reusable controls behavior with consumer-owned state and explicit bindings.
import { equal, ok, test } from '@yaks/testing'
import { assertAlmostEquals } from '@std/assert'
import {
  listen,
  lookDrag,
  type MotionBindings,
  mouseButtons,
  movement as axes,
} from './controls.ts'
import { controlsProbe, pad } from './controls_test_support.ts'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { docs } from './vocab.ts'
import type { ControlsBundle } from './controls.ts'

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
let probe = (
  run: Parameters<typeof controlsProbe<ReturnType<typeof listen>>>[1],
) =>
  controlsProbe(
    (stage, glass, busy, state) =>
      listen(stage, glass, busy, {
        ...state,
        ...bindings,
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
    run,
  )
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
    requests: () => number
    locked: () => boolean
  }) => void,
) =>
  probe((p) =>
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
    })
  )

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

test('steering and orbit use locked deltas or captured drags in either swap', () => {
  for (let hide of [true, false]) {
    for (let swap of [true, false]) {
      for (let button of [0, 2]) {
        mouseProbe((p) => {
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
})

test('escape and native unlock cancel the mouse without a stuck gesture', () => {
  for (let type of ['keydown', 'pointerlockchange']) {
    mouseProbe((p) => {
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
    })
  }
})

test('a late pointer lock grant after release immediately unlocks', () => {
  mouseProbe((p) => {
    p.send('pointerdown')
    p.send('pointerup', 0, 0)
    p.send('mouseup', 0, 0)
    p.lock()
    equal(p.locked(), false)
  })
})

test('a second button while locked needs neither capture nor another lock', () => {
  mouseProbe((p) => {
    p.send('pointerdown')
    p.lock()
    p.send('pointerdown', 2, 3)
    equal(p.requests(), 1)
    equal(p.hands.read().move, [0, 1])
  })
})

test('touch input still starts while a mouse drag is pointer locked', () => {
  mouseProbe((p) => {
    p.send('pointerdown')
    p.lock()
    p.send('pointerdown', 0, 1, 'touch')
    equal(p.locked(), true)
    equal(p.requests(), 1)
  })
})

test('touch stick and look gestures coexist, release, and cancel independently', () => {
  probe((p) => {
    let touch = (type: string, id: number, x: number, y: number) =>
      p.send(type, {
        pointerType: 'touch',
        pointerId: id,
        clientX: x,
        clientY: y,
      })
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
    touch('pointerup', 2, 740, 120)
    equal(p.hands.read().actions, []) // a look drag is not a tap
    equal(p.hands.read().move, [1, 0])
    touch('pointercancel', 1, 212, 100)
    equal(p.hands.read().move, [0, 0])
    touch('pointerdown', 3, 100, 100)
    touch('pointermove', 3, 100, 44)
    touch('lostpointercapture', 3, 100, 44)
    equal(p.hands.read().move, [0, 0])
    equal(p.hands.read().look, false)
  })
})

test('settings and gestures round trip through the consumer-named entity', () => {
  probe((p) => {
    equal(p.changes, [])
    p.hands.swap()
    p.hands.strafe()
    p.hands.hideCursor()
    equal(p.row().Controls?.swapped, true)
    equal(p.row().Controls?.strafe, true)
    equal(p.row().Controls?.hideCursor, false)
    ok(p.changes.every((b) => b.entity.eid == 'test-consumer:pilot-controls'))
    let replacement = {
      entity: { eid: 'another-consumer:controls' },
      Controls: {
        swapped: false,
        strafe: false,
        hideCursor: true,
        held: ['KeyW'],
        pressed: ['external-action'],
      },
    }
    p.replace(replacement)
    equal(p.hands.swapped(), false)
    equal(p.hands.strafes(), false)
    equal(p.hands.hidesCursor(), true)
    equal(p.hands.read().actions, ['external-action'])
    equal(p.hands.read().move, [0, 1])
    equal(p.changes.at(-1)?.entity, replacement.entity)
    equal(p.row().Controls?.pressed, [])
  })
})

test('keys use supplied bindings, deduplicate edges, and release held actions', () => {
  probe((p) => {
    equal(p.send('keydown', { code: 'KeyW' }).defaultPrevented, true)
    equal(p.send('keydown', { code: 'KeyF' }).defaultPrevented, true)
    p.send('keydown', { code: 'KeyF', repeat: true })
    let first = p.hands.read()
    equal(first.move, [0, 1])
    equal(first.actions, ['activate'])
    equal(first.held, ['activate'])
    equal(p.hands.read().actions, [])
    equal(p.hands.read().held, ['activate'])
    p.send('keyup', { code: 'KeyF' })
    p.send('keyup', { code: 'KeyW' })
    equal(p.hands.read().held, [])
    equal(p.hands.read().move, [0, 0])
    for (let fields of [{ metaKey: true }, { ctrlKey: true }]) {
      p.send('keydown', { code: 'KeyF', ...fields })
      equal(p.hands.read().actions, [])
    }
    p.busy(true)
    p.send('keydown', { code: 'KeyF' })
    equal(p.hands.read().actions, [])
    p.busy(false)
    p.send('keydown', { code: 'ArrowLeft' })
    equal(p.hands.read().turn, -6)
  })
})

test('read consumes screen presses, wheel and orbit deltas exactly once', () => {
  probe((p) => {
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
  })
})

test('cursor projection receives current position and pointer-lock status', () => {
  probe((p) => {
    p.send('pointermove', { clientX: 200, clientY: 150 })
    equal(p.hands.pointer(), [0.25, 0.25])
    p.send('pointerdown')
    p.lock()
    equal(p.hands.pointer(), [0, 0])
  })
})

test('dispose removes all browser listeners, unlocks, releases capture and unmounts', () => {
  probe((p) => {
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
    let row = p.row(), changes = p.changes.length
    p.send('keydown', { code: 'KeyF' })
    p.send('wheel', { deltaY: 1 })
    p.send('pointerdown')
    p.send('blur')
    equal(p.row(), row)
    equal(p.changes.length, changes)
  })
})

test('dispose releases captured touch without pointer lock', () => {
  probe((p) => {
    p.send('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 100 })
    equal([...p.captures], [7])
    p.dispose()
    equal(p.captures.size, 0)
    equal(p.listeners(), 0)
  })
})

test('gamepad API is polled per read; presses have edges and remain held', () => {
  probe((p) => {
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
  })
})

test('gamepad disconnects and sparse lists release movement, look and buttons', () => {
  probe((p) => {
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
  })
})

test('gamepad radial deadzone rescales movement and integrates look using dt', () => {
  probe((p) => {
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
  })
})

test('busy and blur suppress gamepad polling, held actions, movement and look', () => {
  probe((p) => {
    p.pads([pad([1, 0, 1, 0], [2])])
    equal(p.hands.read().actions, ['activate'])
    p.busy(true)
    let polls = p.polls(), busy = p.hands.read()
    equal(p.polls(), polls)
    equal(busy.actions, [])
    equal(busy.held, [])
    equal(busy.move, [0, 0])
    equal(busy.orbit, [0, 0])
    equal(busy.look, false)
    p.busy(false)
    equal(p.hands.read().actions, ['activate'])
    p.send('keydown', { code: 'KeyF' })
    p.send('pointerdown')
    p.lock()
    p.send('blur')
    equal(p.locked(), false)
    equal(p.row().Controls?.focused, false)
    polls = p.polls()
    let blurred = p.hands.read()
    equal(p.polls(), polls)
    equal(blurred.actions, [])
    equal(blurred.held, [])
    equal(blurred.move, [0, 0])
    equal(blurred.orbit, [0, 0])
    equal(blurred.look, false)
    p.send('focus')
    equal(p.hands.read().actions, ['activate'])
  })
})

test('gamepad permission refusal is no input and recovers on the next read', () => {
  probe((p) => {
    p.refusePads(new DOMException('permission denied', 'SecurityError'))
    equal(p.hands.read().held, [])
    p.refusePads(undefined)
    p.pads([pad([], [2])])
    equal(p.hands.read().actions, ['activate'])
  })
})

test('keys, touch taps and gamepad buttons emit the same configured action', () => {
  for (let source of ['key', 'touch', 'pad']) {
    probe((p) => {
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
    })
  }
})

test('keyboard, touch and gamepad movement share the same normalized axes', () => {
  for (let source of ['key', 'touch', 'pad']) {
    probe((p) => {
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
})

test('primary mouse tap emits its bound action and preserves the press pick', () => {
  probe((p) => {
    p.hands.hideCursor()
    p.send('pointerdown', { clientX: 200, clientY: 150 })
    p.send('pointerup', { clientX: 202, clientY: 152, buttons: 0 })
    p.send('mouseup', { buttons: 0 })
    let i = p.hands.read()
    equal(i.actions, ['activate'])
    equal(i.pick, [0.25, 0.25])
    equal(p.hands.read().pick, undefined)
  })
})

test('reattaching controls restores preferences from consumer state', () => {
  probe((p) => {
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
      equal(p.row().Controls?.hideCursor, true)
    } finally {
      again.dispose()
    }
    equal(p.listeners(), 0)
  })
})

test('client graph controls round trip preferences and preserve held across setting reads and remount', async () => {
  let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
  let eid = 'test-client:pilot-controls'
  let state = {
    get: (): ControlsBundle => ({
      entity: { eid },
      Controls: front.ent(eid)?.Controls as ControlsBundle['Controls'],
    }),
    onChange: (bundle: ControlsBundle) => {
      front.mutate([bundle])
    },
  }
  let attach = (stage: HTMLElement, glass: HTMLElement, busy: () => boolean) =>
    listen(stage, glass, busy, {
      ...bindings,
      ...state,
      keys: { KeyF: 'activate' },
      cursor: (x, y) => [x, y],
    })
  try {
    await front.ready
    controlsProbe(attach, (p) => {
      p.send('keydown', { code: 'KeyW' })
      p.send('keydown', { code: 'KeyF' })
      p.hands.swap()
      p.hands.strafe()
      p.hands.hideCursor()
      equal(state.get().Controls?.held, ['KeyW', 'KeyF'])
      equal(p.hands.swapped(), true)
      equal(p.hands.strafes(), true)
      let i = p.hands.read()
      equal(i.move, [0, 1])
      equal(i.actions, ['activate'])
      equal(i.held, ['activate'])
      equal(p.hands.read().held, ['activate'])
      equal(state.get().Controls?.held, ['KeyW', 'KeyF'])
      // A consumer can change another preference without replacing transient input.
      front.mutate([{ entity: { eid }, Controls: { swapped: false } }])
      equal(p.hands.swapped(), false)
      equal(p.hands.read().held, ['activate'])
      p.dispose()
      let again = attach(p.stage, p.glass, () => false)
      try {
        equal(again.hidesCursor(), false)
        equal(again.strafes(), true)
        equal(again.swapped(), false)
        equal(again.read().held, []) // dispose deliberately cancels old gestures
        p.send('keydown', { code: 'KeyF' })
        equal(again.read().actions, ['activate'])
        equal(again.read().held, ['activate'])
        again.swap()
        equal(again.read().held, ['activate'])
        p.send('keyup', { code: 'KeyF' })
        equal(again.read().held, [])
        equal(state.get().entity.eid, eid)
      } finally {
        again.dispose()
      }
      equal(p.listeners(), 0)
    })
  } finally {
    front.close()
  }
})

test('unbound keys do not enter consumer held state and busy masks held verbs', () => {
  probe((p) => {
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
  })
})
