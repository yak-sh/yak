/** Browser controls over consumer-owned values. No graph or world is imported.
 * The consumer reads a named Controls bundle and applies every emitted bundle.
 * Event closures hold only DOM resources; all gesture/settings state is in Controls.
 */
import { h, render } from 'preact'
import { Stick } from './hud.ts'

export type MotionBindings = {
  axes: Record<string, [number, number]>
  turns: Record<string, number>
  turnRate?: number
}
export type Intent = {
  move: [number, number]
  turn: number
  faceMove: boolean
  actions: string[]
  held: string[]
  pick?: [number, number]
  orbit: [number, number]
  look: boolean
  zoom: number
}
type Mouse = { buttons: number; far: number; chorded: boolean }
type Drag = { x: number; y: number; far: number; button: number; type: string }
export type ControlsState = {
  move: [number, number]
  look: [number, number]
  held: string[]
  pressed: string[]
  orbit: [number, number]
  looked: boolean
  zoom: number
  pointer: [number, number] | null
  click: [number, number] | null
  pressAt: [number, number] | null
  swapped: boolean
  strafe: boolean
  hideCursor: boolean
  locking: boolean
  focused: boolean
  stick: { id: number; x: number; y: number; dx: number; dy: number } | null
  drags: Record<string, Drag>
  mouse: Mouse
  pad: string[]
}
export type ControlsBundle = {
  entity: { eid: string }
  Controls?: Partial<ControlsState>
}
export let initial = (): ControlsState => ({
  move: [0, 0],
  look: [0, 0],
  held: [],
  pressed: [],
  orbit: [0, 0],
  looked: false,
  zoom: 0,
  pointer: null,
  click: null,
  pressAt: null,
  swapped: false,
  strafe: false,
  hideCursor: true,
  locking: false,
  focused: true,
  stick: null,
  drags: {},
  mouse: { buttons: 0, far: 0, chorded: false },
  pad: [],
})
export type GamepadBindings = {
  move?: [number, number]
  look?: [number, number]
  buttons?: Record<number, string>
  deadzone?: number
  lookRate?: number
}
export type Pad = Pick<Gamepad, 'axes' | 'buttons' | 'connected'>
/** Browser lists can contain holes after disconnect; permission refusal is no input. */
export let pollGamepads = (): (Pad | null)[] => {
  try {
    return [...(globalThis.navigator?.getGamepads?.() ?? [])]
  } catch (e) {
    if (e instanceof DOMException && e.name == 'SecurityError') return []
    throw e
  }
}
/** Values only; axis dead zone is radial and scales the usable remainder. */
export let gamepad = (
  pads: readonly (Pad | null)[],
  bindings?: GamepadBindings,
) => {
  let move: [number, number] = [0, 0],
    look: [number, number] = [0, 0],
    held = new Set<string>()
  let pair = (pad: Pad, axes?: [number, number]): [number, number] => {
    if (!axes) return [0, 0]
    let x = pad.axes[axes[0]] ?? 0, y = pad.axes[axes[1]] ?? 0
    let len = Math.hypot(x, y),
      dead = Math.max(0, Math.min(.99, bindings?.deadzone ?? .15))
    let scale = len > dead ? (Math.min(1, len) - dead) / (1 - dead) / len : 0
    return [x * scale, y * scale]
  }
  for (let pad of pads) {
    if (!pad?.connected) continue
    let m = pair(pad, bindings?.move), l = pair(pad, bindings?.look)
    move[0] += m[0]
    move[1] -= m[1]
    look[0] += l[0]
    look[1] += l[1]
    for (let [button, action] of Object.entries(bindings?.buttons ?? {})) {
      if (pad.buttons[+button]?.pressed) held.add(action)
    }
  }
  for (let v of [move, look]) {
    let len = Math.hypot(...v)
    if (len > 1) {
      v[0] /= len
      v[1] /= len
    }
  }
  return { move, look, held: [...held] }
}
export let movement = (
  held: Iterable<string>,
  strafe: boolean,
  stick?: [number, number],
  mouseWalk = false,
  bindings: MotionBindings = { axes: {}, turns: {} },
): Pick<Intent, 'move' | 'turn' | 'faceMove'> => {
  let x = 0, y = 0, keyTurn = 0
  for (let code of held) {
    if (bindings.turns[code]) keyTurn += bindings.turns[code]
    let a = bindings.axes[code]
    if (a) {
      if (a[0] && !strafe) keyTurn += a[0]
      else x += a[0]
      y += a[1]
    }
  }
  if (stick) x += stick[0], y += stick[1]
  if (mouseWalk) y++
  let len = Math.hypot(x, y)
  if (len > 1) [x, y] = [x / len, y / len]
  return {
    move: [x, y],
    turn: Math.max(-1, Math.min(1, keyTurn)) * (bindings.turnRate ?? 6),
    faceMove: !!stick && Math.hypot(...stick) > 0.01,
  }
}

let STICK = 56

/** A nonstick touch uses the look hand; mouse buttons may
 * swap their roles in the menu. */
export let lookDrag = (button: number, type: string, swapped: boolean) =>
  type == 'touch' || button == (swapped ? 0 : 2)

// A mouse has one pointer even while two buttons are down. Its second press
// and first release arrive as mouse events, without a pointerdown or pointerup.
export let mouseButtons = (state: () => Mouse = (() => {
  let value = { buttons: 0, far: 0, chorded: false }
  return () => value
})()) => {
  let bit = (button: number) => button == 0 ? 1 : button == 2 ? 2 : 0
  return {
    down: (button: number) => {
      let b = bit(button)
      if (!b) return
      if (!state().buttons) state().far = 0, state().chorded = false
      state().buttons |= b
      if (state().buttons == 3) state().chorded = true
    },
    move: (mask: number, distance: number) => {
      if (!state().buttons) return
      state().far += distance
      if (mask & 3) state().buttons = mask & 3
      if (state().buttons == 3) state().chorded = true
    },
    up: (button: number): number | undefined => {
      let b = bit(button)
      if (!(state().buttons & b)) return
      state().buttons &= ~b
      return !state().chorded && state().far < 8 ? button : undefined
    },
    walk: () => state().buttons == 3,
    chorded: () => state().chorded,
    active: () => state().buttons != 0,
    cancel: () => {
      state().buttons = state().far = 0
      state().chorded = false
    },
  }
}

/** Attach browser resources. Call read once per frame; dispose releases every listener. */
export let listen = (
  stage: HTMLElement,
  glass: HTMLElement,
  busy: () => boolean,
  options: MotionBindings & {
    keys: Record<string, string>
    tap?: Record<number, string>
    gamepad?: GamepadBindings
    poll?: () => (Pad | null)[]
    cursor: (x: number, y: number, locked: boolean) => [number, number]
    get: () => ControlsBundle
    onChange: (bundle: ControlsBundle) => void
  },
) => {
  let s: ControlsState
  let depth = 0
  let transaction = <T>(fn: () => T): T => {
    if (depth) return fn()
    let row = options.get()
    s = { ...initial(), ...structuredClone(row.Controls ?? {}) }
    let before = JSON.stringify(s)
    depth++
    try {
      return fn()
    } finally {
      depth--
      if (JSON.stringify(s) != before) {
        options.onChange({ entity: row.entity, Controls: s })
      }
      paint()
    }
  }
  // Sets are views of serializable arrays, never a second store of the state.
  let sequence = (key: 'held' | 'pressed') => ({
    add: (value: string) => {
      if (!s[key].includes(value)) s[key].push(value)
    },
    delete: (value: string) => {
      s[key] = s[key].filter((v) => v != value)
    },
    has: (value: string) => s[key].includes(value),
    clear: () => {
      s[key] = []
    },
    [Symbol.iterator]: () => s[key][Symbol.iterator](),
  })
  let listeners: (() => void)[] = []
  let on = <K extends keyof DocumentEventMap>(
    target: EventTarget,
    name: K,
    fn: (e: DocumentEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) => {
    let handler = (e: Event) => transaction(() => fn(e as DocumentEventMap[K]))
    target.addEventListener(name, handler, opts)
    listeners.push(() => target.removeEventListener(name, handler, opts))
  }
  let pressButton = (button: number) => {
    let action = options.tap?.[button]
    if (action) pressed.add(action)
  }
  s = { ...initial(), ...structuredClone(options.get().Controls ?? {}) }
  let isLook = (button: number, type: string) =>
    lookDrag(button, type, s.swapped)
  let held = sequence('held'), pressed = sequence('pressed')
  let drags = {
    get: (id: number) => s.drags[id],
    set: (id: number, value: Drag) => {
      s.drags[id] = value
    },
    delete: (id: number) => {
      delete s.drags[id]
    },
    clear: () => {
      s.drags = {}
    },
    keys: () => Object.keys(s.drags).map(Number),
    values: () => Object.values(s.drags),
    [Symbol.iterator]: () =>
      Object.entries(s.drags).map(([id, d]) => [Number(id), d] as const)
        [Symbol.iterator](),
  }
  let mouse = mouseButtons(() => s.mouse)
  let locked = () => document.pointerLockElement == stage
  let unlock = () => {
    if (locked()) document.exitPointerLock()
  }
  let cancelMouse = () => {
    mouse.cancel()
    for (let [id, d] of drags) if (d.type == 'mouse') drags.delete(id)
    s.looked = false
  }
  on(document, 'pointerlockchange', () => {
    s.locking = false
    if (locked()) {
      // A quick release can precede the browser granting the request.
      if (!s.hideCursor || !mouse.active()) unlock()
    } else cancelMouse()
  })
  on(document, 'pointerlockerror', () => {
    s.locking = false // A refused lock leaves the captured drag usable.
  })
  on(globalThis, 'keydown', (e) => {
    if (e.code != 'Escape' || !locked()) return
    e.stopImmediatePropagation()
    cancelMouse()
    unlock()
  }, { capture: true })

  let base = document.createElement('div')
  glass.append(base)
  let paint = () =>
    render(
      h(
        Stick,
        s.stick
          ? {
            rest: false,
            x: s.stick.x,
            y: s.stick.y,
            dx: s.stick.dx * STICK,
            dy: s.stick.dy * STICK,
          }
          : { rest: true },
      ),
      base,
    )
  let rest = () => {
    s.stick = null
  }
  paint()

  on(globalThis, 'keydown', (e) => {
    if (busy() || e.metaKey || e.ctrlKey) return
    if (options.axes[e.code] || options.turns[e.code] || options.keys[e.code]) {
      e.preventDefault()
    }
    if (e.repeat) return
    if (
      !options.axes[e.code] && !options.turns[e.code] && !options.keys[e.code]
    ) return
    held.add(e.code)
    let a = options.keys[e.code]
    if (a) pressed.add(a)
  })
  on(globalThis, 'keyup', (e) => held.delete(e.code))
  let clear = () => {
    s.pad = []
    held.clear()
    pressed.clear()
    s.orbit = [0, 0]
    s.looked = false
    s.zoom = 0
    mouse.cancel()
    unlock()
    for (let id of [...drags.keys(), ...(s.stick ? [s.stick.id] : [])]) {
      if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id)
    }
    drags.clear()
    s.stick = null
    rest()
  }
  on(globalThis, 'blur', () => {
    s.focused = false
    clear()
  })
  on(globalThis, 'focus', () => {
    s.focused = true
  })

  on(stage, 'contextmenu', (e) => e.preventDefault())
  on(stage, 'pointerdown', (e) => {
    s.pointer = [e.clientX, e.clientY]
    if (e.button == 0) {
      s.pressAt = options.cursor(...s.pointer, locked())
    }
    if (!document.pointerLockElement) stage.setPointerCapture(e.pointerId)
    if (e.pointerType == 'mouse') {
      mouse.down(e.button)
      if (
        mouse.active() && s.hideCursor && !locked() && stage.requestPointerLock
      ) {
        s.locking = true
        // Older browsers return void; newer ones also reject a promise.
        stage.requestPointerLock()?.catch(() => {
          s.locking = false
        })
      }
    }
    if (e.pointerType == 'touch' && !s.stick && e.clientX < innerWidth * 0.45) {
      s.stick = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
      return
    }
    drags.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      far: 0,
      button: e.button,
      type: e.pointerType,
    })
  })
  on(stage, 'mousedown', (e) => {
    if (mouse.active()) mouse.down(e.button)
    if (mouse.chorded()) s.looked = false
  })
  on(globalThis, 'mouseup', (e) => {
    let action = mouse.up(e.button)
    if (action !== undefined) {
      pressButton(action)
      if (action == 0) s.click = s.pressAt
    }
    if (!mouse.active()) {
      for (let [id, d] of drags) if (d.type == 'mouse') drags.delete(id)
      unlock()
    }
  })
  on(stage, 'mousemove', (e) => {
    if (!locked() || !mouse.active()) return
    mouse.move(e.buttons, Math.hypot(e.movementX, e.movementY))
    s.orbit[0] -= e.movementX * 0.006
    s.orbit[1] += e.movementY * 0.006
    let d = [...drags.values()].find((d) => d.type == 'mouse')
    if (d && !mouse.chorded() && isLook(d.button, d.type)) s.looked = true
  })
  on(stage, 'pointermove', (e) => {
    if (e.pointerType == 'mouse' && locked()) return
    s.pointer = [e.clientX, e.clientY]
    if (s.stick?.id == e.pointerId) {
      let dx = e.clientX - s.stick.x, dy = e.clientY - s.stick.y
      let d = Math.hypot(dx, dy)
      let k = d > STICK ? STICK / d : 1
      s.stick.dx = (dx * k) / STICK
      s.stick.dy = (dy * k) / STICK
      return
    }
    let d = drags.get(e.pointerId)
    if (!d) return
    let mx = e.pointerType == 'touch' ? e.clientX - d.x : e.movementX
    let my = e.pointerType == 'touch' ? e.clientY - d.y : e.movementY
    d.far += Math.hypot(mx, my)
    if (e.pointerType == 'mouse') {
      mouse.move(e.buttons, Math.hypot(mx, my))
      if (mouse.chorded()) s.looked = false
    }
    d.x = e.clientX
    d.y = e.clientY
    let k = e.pointerType == 'touch' ? 0.009 : 0.006
    s.orbit[0] -= mx * k
    s.orbit[1] += my * k
    if (!mouse.chorded() && isLook(d.button, d.type)) s.looked = true
  })
  let up = (e: PointerEvent) => {
    if (s.stick?.id == e.pointerId) {
      s.stick = null
      rest()
      return
    }
    let d = drags.get(e.pointerId)
    drags.delete(e.pointerId)
    if (e.pointerType == 'mouse') {
      if (e.type == 'pointercancel') mouse.cancel()
      else {
        let action = mouse.up(e.button)
        if (action !== undefined) {
          pressButton(action)
          if (action == 0) s.click = s.pressAt
        }
      }
      if (!mouse.active()) unlock()
      return
    }
    // Touch and pen use their s.pointer release; a tap on the right of a phone
    // is a blow too, where the thumb already is.
    if (d && d.far < 8 && e.type == 'pointerup') {
      pressButton(d.button)
    }
  }
  on(stage, 'pointerup', up)
  on(stage, 'pointercancel', up)
  on(stage, 'lostpointercapture', (e) => {
    if (e.pointerType == 'mouse' && (s.locking || locked())) return
    // Chrome drops capture when the second mouse button goes down.
    if (e.pointerType == 'mouse' && mouse.active() && e.buttons & 3) {
      if (!document.pointerLockElement) stage.setPointerCapture(e.pointerId)
      return
    }
    drags.delete(e.pointerId)
    if (e.pointerType == 'mouse') mouse.cancel()
    if (s.stick?.id == e.pointerId) {
      s.stick = null
      rest()
    }
  })
  on(stage, 'wheel', (e) => {
    e.preventDefault()
    s.zoom += Math.sign(e.deltaY)
  }, { passive: false })

  return {
    /** press an action from a button on the screen */
    press: (a: string) => transaction(() => pressed.add(a)),
    swapped: () => transaction(() => s.swapped),
    swap: () =>
      transaction(() => {
        s.swapped = !s.swapped
      }),
    pointer: (): [number, number] =>
      transaction(() =>
        s.pointer ? options.cursor(...s.pointer, locked()) : [0, 0]
      ),
    hidesCursor: () => transaction(() => s.hideCursor),
    hideCursor: () =>
      transaction(() => {
        s.hideCursor = !s.hideCursor
        if (!s.hideCursor) unlock()
      }),
    strafes: () => transaction(() => s.strafe),
    strafe: () =>
      transaction(() => {
        s.strafe = !s.strafe
      }),
    dispose: () => {
      for (let remove of listeners) remove()
      transaction(() => {
        clear()
        unlock()
      })
      render(null, base)
      base.remove()
    },
    read: (dt = 1 / 60): Intent =>
      transaction(() => {
        let pad = gamepad(
          busy() || !s.focused ? [] : (options.poll ?? pollGamepads)(),
          options.gamepad,
        )
        for (let a of pad.held) if (!s.pad.includes(a)) pressed.add(a)
        s.pad = pad.held
        let analog: [number, number] = [
          pad.move[0] + (s.stick?.dx ?? 0),
          pad.move[1] - (s.stick?.dy ?? 0),
        ]
        let axes = movement(
          busy() ? [] : held,
          s.strafe,
          analog,
          mouse.walk(),
          options,
        )
        let out: Intent = {
          ...axes,
          actions: [...pressed],
          held: busy() ? [] : [
            ...new Set(
              [...held].map((code) => options.keys[code]).filter(Boolean)
                .concat(pad.held),
            ),
          ],
          pick: s.click ?? undefined,
          orbit: [
            s.orbit[0] - pad.look[0] * dt * (options.gamepad?.lookRate ?? 3),
            s.orbit[1] + pad.look[1] * dt * (options.gamepad?.lookRate ?? 3),
          ],
          look: !mouse.chorded() &&
            (s.looked || pad.look.some((v) => v != 0) ||
              [...drags.values()].some((d) => isLook(d.button, d.type))),
          zoom: s.zoom,
        }
        s.move = out.move
        s.look = out.orbit
        pressed.clear()
        s.click = null
        s.orbit = [0, 0]
        s.looked = false
        s.zoom = 0
        return out
      }),
  }
}
