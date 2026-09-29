// What the player asks for, from whichever hands they use: keys and a mouse,
// or a thumb on a stick and another on the buttons. The frame reads it once
// (`read`) and gets one answer: which way to move or turn, what was pressed
// since the last frame, and how far the view was dragged.

export type Intent = {
  /** right and forward axes, at most 1 long */
  move: [number, number]
  /** turn in radians/second; the camera and hero turn together */
  turn: number
  /** the thumbstick faces the direction it moves */
  faceMove: boolean
  jump: boolean
  strike: boolean
  /** the ability asked for, by its slot on the bar, 1 to 3, or 0 */
  ability: number
  dodge: boolean
  talk: boolean
  /** work the node near enough to work (work.ts) */
  gather: boolean
  drink: boolean
  /** swing the camera behind the hero */
  snap: boolean
  /** turn the microphone on, or off */
  mic: boolean
  /** how far the view was turned since the last read: yaw, pitch */
  orbit: [number, number]
  /** a look drag holds the hero's heading while the camera turns */
  look: boolean
  /** how far it was pulled in or out */
  zoom: number
}

export type Action =
  | 'jump'
  | 'strike'
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'dodge'
  | 'talk'
  | 'gather'
  | 'drink'
  | 'snap'
  | 'mic'

// The keys for each action; the panels' keys are their own (hud.ts).
let KEYS: Record<string, Action> = {
  Space: 'jump',
  KeyF: 'strike',
  KeyJ: 'strike',
  ShiftLeft: 'dodge',
  ShiftRight: 'dodge',
  KeyE: 'talk',
  KeyG: 'gather',
  Digit1: 'ability1',
  Digit2: 'ability2',
  Digit3: 'ability3',
  KeyQ: 'drink',
  KeyC: 'snap',
  KeyT: 'mic',
}

/** The keys that press `a`, as `KeyboardEvent.code`s, the first the one a
 * button shows.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(keysOf('strike'), ['KeyF', 'KeyJ'])
 * ```
 */
export let keysOf = (a: Action): string[] =>
  Object.keys(KEYS).filter((k) => KEYS[k] == a)

let AXES: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
}

let TURNS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
}

let KEY_TURN = 6

/** Arrows turn the camera and hero together; A/D turn or strafe according to
 * the setting. Movement axes are resolved against the chosen view or hero
 * heading by the frame. Both mouse buttons add forward motion. Diagonals are
 * no faster.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(movement(['KeyA'], true), {
 *   move: [-1, 0], turn: 0, faceMove: false,
 * })
 * assertEquals(movement(['KeyA'], false), {
 *   move: [0, 0], turn: -6, faceMove: false,
 * })
 * assertEquals(movement(['ArrowLeft'], true), {
 *   move: [0, 0], turn: -6, faceMove: false,
 * })
 * assertEquals(movement(['ArrowRight', 'KeyA'], true), {
 *   move: [-1, 0], turn: 6, faceMove: false,
 * })
 * assertEquals(movement([], true, [1, 0]), {
 *   move: [1, 0], turn: 0, faceMove: true,
 * })
 * assertEquals(movement([], false, undefined, true), {
 *   move: [0, 1], turn: 0, faceMove: false,
 * })
 * ```
 */
export let movement = (
  held: Iterable<string>,
  strafe: boolean,
  stick?: [number, number],
  mouseWalk = false,
): Pick<Intent, 'move' | 'turn' | 'faceMove'> => {
  let x = 0, y = 0, keyTurn = 0
  for (let code of held) {
    if (TURNS[code]) keyTurn += TURNS[code]
    let a = AXES[code]
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
    turn: Math.max(-1, Math.min(1, keyTurn)) * KEY_TURN,
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
export let mouseButtons = () => {
  let buttons = 0, far = 0, chorded = false
  let bit = (button: number) => button == 0 ? 1 : button == 2 ? 2 : 0
  return {
    down: (button: number) => {
      let b = bit(button)
      if (!b) return
      if (!buttons) far = 0, chorded = false
      buttons |= b
      if (buttons == 3) chorded = true
    },
    move: (mask: number, distance: number) => {
      if (!buttons) return
      far += distance
      if (mask & 3) buttons = mask & 3
      if (buttons == 3) chorded = true
    },
    up: (button: number): Action | undefined => {
      let b = bit(button)
      if (!(buttons & b)) return
      buttons &= ~b
      return !chorded && far < 8 ? button == 0 ? 'strike' : 'dodge' : undefined
    },
    walk: () => buttons == 3,
    chorded: () => chorded,
    active: () => buttons != 0,
    cancel: () => {
      buttons = far = 0
      chorded = false
    },
  }
}

/** Listen on `stage` and the window. `busy` says when the keyboard belongs
 * to something else (a name being typed); the thumbstick is drawn in
 * `glass`, resting in its corner until a thumb lands. */
export let listen = (
  stage: HTMLElement,
  glass: HTMLElement,
  busy: () => boolean,
) => {
  let held = new Set<string>()
  let pressed = new Set<Action>()
  let orbit: [number, number] = [0, 0]
  let looked = false
  let zoom = 0
  let swapped = false
  let strafe = false
  try {
    swapped = localStorage.getItem('mossvale.drag.swap') == '1'
    strafe = localStorage.getItem('mossvale.keys.strafe') == '1'
  } catch { /* this page keeps its setting */ }
  let isLook = (button: number, type: string) => lookDrag(button, type, swapped)
  let stick:
    | { id: number; x: number; y: number; dx: number; dy: number }
    | null = null
  let drags = new Map<
    number,
    { x: number; y: number; far: number; button: number; type: string }
  >()
  let mouse = mouseButtons()

  let base = document.createElement('div')
  base.className = 'Stick'
  let knob = document.createElement('div')
  knob.className = 'Stick_Knob'
  base.append(knob)
  glass.append(base)
  let rest = () => {
    base.classList.add('Stick-rest')
    base.style.transform = ''
    knob.style.transform = ''
  }
  rest()

  addEventListener('keydown', (e) => {
    if (busy() || e.metaKey || e.ctrlKey) return
    if (AXES[e.code] || TURNS[e.code] || KEYS[e.code]) e.preventDefault()
    if (e.repeat) return
    held.add(e.code)
    let a = KEYS[e.code]
    if (a) pressed.add(a)
  })
  addEventListener('keyup', (e) => held.delete(e.code))
  addEventListener('blur', () => {
    held.clear()
    pressed.clear()
    orbit = [0, 0]
    looked = false
    zoom = 0
    mouse.cancel()
    for (let id of drags.keys()) {
      if (stage.hasPointerCapture(id)) stage.releasePointerCapture(id)
    }
    drags.clear()
    stick = null
    rest()
  })

  stage.addEventListener('contextmenu', (e) => e.preventDefault())
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId)
    if (e.pointerType == 'mouse') mouse.down(e.button)
    if (e.pointerType == 'touch' && !stick && e.clientX < innerWidth * 0.45) {
      stick = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
      base.classList.remove('Stick-rest')
      base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      knob.style.transform = ''
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
  stage.addEventListener('mousedown', (e) => {
    if (mouse.active()) mouse.down(e.button)
    if (mouse.chorded()) looked = false
  })
  addEventListener('mouseup', (e) => {
    let action = mouse.up(e.button)
    if (action) pressed.add(action)
  })
  stage.addEventListener('pointermove', (e) => {
    if (stick?.id == e.pointerId) {
      let dx = e.clientX - stick.x, dy = e.clientY - stick.y
      let d = Math.hypot(dx, dy)
      let k = d > STICK ? STICK / d : 1
      stick.dx = (dx * k) / STICK
      stick.dy = (dy * k) / STICK
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`
      return
    }
    let d = drags.get(e.pointerId)
    if (!d) return
    let mx = e.pointerType == 'touch' ? e.clientX - d.x : e.movementX
    let my = e.pointerType == 'touch' ? e.clientY - d.y : e.movementY
    d.far += Math.hypot(mx, my)
    if (e.pointerType == 'mouse') {
      mouse.move(e.buttons, Math.hypot(mx, my))
      if (mouse.chorded()) looked = false
    }
    d.x = e.clientX
    d.y = e.clientY
    let k = e.pointerType == 'touch' ? 0.009 : 0.006
    orbit[0] -= mx * k
    orbit[1] += my * k
    if (!mouse.chorded() && isLook(d.button, d.type)) looked = true
  })
  let up = (e: PointerEvent) => {
    if (stick?.id == e.pointerId) {
      stick = null
      rest()
      return
    }
    let d = drags.get(e.pointerId)
    drags.delete(e.pointerId)
    if (e.pointerType == 'mouse') {
      if (e.type == 'pointercancel') mouse.cancel()
      else {
        let action = mouse.up(e.button)
        if (action) pressed.add(action)
      }
      return
    }
    // Touch and pen use their pointer release; a tap on the right of a phone
    // is a blow too, where the thumb already is.
    if (d && d.far < 8 && e.type == 'pointerup') {
      if (d.button == 0) pressed.add('strike')
      if (d.button == 2) pressed.add('dodge')
    }
  }
  stage.addEventListener('pointerup', up)
  stage.addEventListener('pointercancel', up)
  stage.addEventListener('lostpointercapture', (e) => {
    // Chrome drops capture when the second mouse button goes down.
    if (e.pointerType == 'mouse' && mouse.active() && e.buttons & 3) {
      stage.setPointerCapture(e.pointerId)
      return
    }
    drags.delete(e.pointerId)
    if (e.pointerType == 'mouse') mouse.cancel()
    if (stick?.id == e.pointerId) {
      stick = null
      rest()
    }
  })
  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoom += Math.sign(e.deltaY)
  }, { passive: false })

  return {
    /** press an action from a button on the screen */
    press: (a: Action) => pressed.add(a),
    swapped: () => swapped,
    swap: () => {
      swapped = !swapped
      try {
        localStorage.setItem('mossvale.drag.swap', swapped ? '1' : '0')
      } catch { /* this page keeps its setting */ }
    },
    strafes: () => strafe,
    strafe: () => {
      strafe = !strafe
      try {
        localStorage.setItem('mossvale.keys.strafe', strafe ? '1' : '0')
      } catch { /* this page keeps its setting */ }
    },
    read: (): Intent => {
      let axes = movement(
        busy() ? [] : held,
        strafe,
        stick ? [stick.dx, -stick.dy] : undefined,
        mouse.walk(),
      )
      let out: Intent = {
        ...axes,
        jump: pressed.has('jump') || (!busy() && held.has('Space')),
        strike: pressed.has('strike'),
        ability: [1, 2, 3].find((n) => pressed.has(`ability${n}` as Action)) ??
          0,
        dodge: pressed.has('dodge'),
        talk: pressed.has('talk'),
        gather: pressed.has('gather'),
        drink: pressed.has('drink'),
        snap: pressed.has('snap'),
        mic: pressed.has('mic'),
        orbit: [orbit[0], orbit[1]],
        look: !mouse.chorded() && (looked ||
          [...drags.values()].some((d) => isLook(d.button, d.type))),
        zoom,
      }
      pressed.clear()
      orbit = [0, 0]
      looked = false
      zoom = 0
      return out
    },
  }
}
