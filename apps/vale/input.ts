// What the player asks for, from whichever hands they use: keys and a mouse,
// or a thumb on a stick and another on the buttons. The frame reads it once
// (`read`) and gets one answer: which way to move, relative to the camera,
// what was pressed since the last frame, and how far the view was dragged.

export type Intent = {
  /** right and forward, relative to the camera, at most 1 long */
  move: [number, number]
  jump: boolean
  strike: boolean
  talk: boolean
  drink: boolean
  /** how far the view was turned since the last read: yaw, pitch */
  orbit: [number, number]
  /** how far it was pulled in or out */
  zoom: number
}

export type Action = 'jump' | 'strike' | 'talk' | 'drink'

let KEYS: Record<string, Action> = {
  Space: 'jump',
  KeyF: 'strike',
  KeyJ: 'strike',
  Enter: 'strike',
  KeyE: 'talk',
  Digit1: 'drink',
  KeyQ: 'drink',
}

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
 * to something else (a name being typed). */
export let listen = (stage: HTMLElement, busy: () => boolean) => {
  let held = new Set<string>()
  let pressed = new Set<Action>()
  let orbit: [number, number] = [0, 0]
  let zoom = 0
  let stick:
    | { id: number; x: number; y: number; dx: number; dy: number }
    | null = null
  let drags = new Map<
    number,
    { x: number; y: number; far: number; button: number }
  >()

  let base = document.createElement('div')
  base.className = 'Stick'
  base.hidden = true
  let knob = document.createElement('div')
  knob.className = 'Stick_Knob'
  base.append(knob)
  document.body.append(base)

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
      base.hidden = false
      base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      knob.style.transform = ''
      return
    }
    drags.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      far: 0,
      button: e.button,
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
    let mx = e.clientX - d.x, my = e.clientY - d.y
    d.far += Math.hypot(mx, my)
    d.x = e.clientX
    d.y = e.clientY
    let k = e.pointerType == 'touch' ? 0.009 : 0.006
    orbit[0] -= mx * k
    orbit[1] += my * k
  })
  let up = (e: PointerEvent) => {
    if (stick?.id == e.pointerId) {
      stick = null
      base.hidden = true
      return
    }
    let d = drags.get(e.pointerId)
    drags.delete(e.pointerId)
    // A click that did not drag is a blow; a tap on the right of a phone,
    // too, where the thumb already is.
    if (d && d.far < 8 && d.button == 0 && e.type == 'pointerup') {
      pressed.add('strike')
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
        talk: pressed.has('talk'),
        drink: pressed.has('drink'),
        orbit: [orbit[0], orbit[1]],
        zoom,
      }
      pressed.clear()
      orbit = [0, 0]
      zoom = 0
      return out
    },
  }
}
