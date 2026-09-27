// What the player asks for, from whichever hands they use: keys and a mouse,
// or a thumb on a stick and another on the buttons. The frame reads it once
// (`read`) and gets one answer: which way to move, relative to the camera,
// what was pressed since the last frame, and how far the view was dragged.

export type Intent = {
  /** right and forward, relative to the camera, at most 1 long */
  move: [number, number]
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
  /** the camera follows the hero, or stops following */
  follow: boolean
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
  | 'follow'
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
  KeyV: 'follow',
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
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}

let STICK = 56

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
  try {
    swapped = localStorage.getItem('mossvale.drag.swap') == '1'
  } catch { /* this page keeps its setting */ }
  let isLook = (button: number, type: string) =>
    type != 'touch' && button == (swapped ? 0 : 2)
  let stick:
    | { id: number; x: number; y: number; dx: number; dy: number }
    | null = null
  let drags = new Map<
    number,
    { x: number; y: number; far: number; button: number; type: string }
  >()

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
    if (AXES[e.code] || KEYS[e.code]) e.preventDefault()
    if (e.repeat) return
    held.add(e.code)
    let a = KEYS[e.code]
    if (a) pressed.add(a)
  })
  addEventListener('keyup', (e) => held.delete(e.code))
  addEventListener('blur', () => held.clear())

  stage.addEventListener('contextmenu', (e) => e.preventDefault())
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId)
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
    let mx = e.clientX - d.x
    let my = e.clientY - d.y
    d.far += Math.hypot(mx, my)
    d.x = e.clientX
    d.y = e.clientY
    let k = e.pointerType == 'touch' ? 0.009 : 0.006
    orbit[0] -= mx * k
    orbit[1] += my * k
    if (isLook(d.button, d.type)) looked = true
  })
  let up = (e: PointerEvent) => {
    if (stick?.id == e.pointerId) {
      stick = null
      rest()
      return
    }
    let d = drags.get(e.pointerId)
    drags.delete(e.pointerId)
    // A click that did not drag is a blow, or a dodge from the right
    // button; a tap on the right of a phone is a blow too, where the thumb
    // already is.
    if (d && d.far < 8 && e.type == 'pointerup') {
      if (d.button == 0) pressed.add('strike')
      if (d.button == 2) pressed.add('dodge')
    }
  }
  stage.addEventListener('pointerup', up)
  stage.addEventListener('pointercancel', up)
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
    read: (): Intent => {
      let x = 0, y = 0
      if (!busy()) {
        for (let code of held) {
          let a = AXES[code]
          if (a) [x, y] = [x + a[0], y + a[1]]
        }
      }
      if (stick) [x, y] = [x + stick.dx, y - stick.dy]
      let len = Math.hypot(x, y)
      if (len > 1) [x, y] = [x / len, y / len]
      let out: Intent = {
        move: [x, y],
        jump: pressed.has('jump') || (!busy() && held.has('Space')),
        strike: pressed.has('strike'),
        ability: [1, 2, 3].find((n) => pressed.has(`ability${n}` as Action)) ??
          0,
        dodge: pressed.has('dodge'),
        talk: pressed.has('talk'),
        gather: pressed.has('gather'),
        drink: pressed.has('drink'),
        snap: pressed.has('snap'),
        follow: pressed.has('follow'),
        mic: pressed.has('mic'),
        orbit: [orbit[0], orbit[1]],
        look: looked ||
          [...drags.values()].some((d) => isLook(d.button, d.type)),
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
