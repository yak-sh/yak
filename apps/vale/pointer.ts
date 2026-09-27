// One pointer lock for the vale. Its cursor moves over the scene and the
// glass, sending DOM events to what it points at while the system cursor is
// hidden. The lock ends on Escape or when the page loses focus.

let clamp = (n: number, max: number) => Math.max(0, Math.min(max - 1, n))

/** Keep the game's pointer over `stage` until the player leaves the lock. */
export let pointer = (stage: HTMLElement, glass: HTMLElement) => {
  let x = innerWidth / 2, y = innerHeight / 2
  let cursor = document.createElement('div')
  cursor.className = 'Pointer'
  cursor.hidden = true
  cursor.setAttribute('aria-hidden', 'true')
  document.body.append(cursor)
  let hover: Element | null = null
  let down: Element | null = null
  let clicked: Element | null = null
  let world = false
  let far = 0
  let locked = () => document.pointerLockElement == stage
  let target = () => document.elementFromPoint(x, y)
  let ui = (t: Element | null) => t && glass.contains(t) ? t : null
  let paint = () => cursor.style.translate = `${x}px ${y}px`
  let mouse = (
    type: string,
    t: Element,
    e: MouseEvent,
    rel: EventTarget | null = null,
  ) =>
    t.dispatchEvent(
      new MouseEvent(type, {
        bubbles: !['mouseenter', 'mouseleave'].includes(type),
        cancelable: true,
        clientX: x,
        clientY: y,
        screenX: e.screenX + x - e.clientX,
        screenY: e.screenY + y - e.clientY,
        button: e.button,
        buttons: e.buttons,
        relatedTarget: rel,
      }),
    )
  let point = (
    type: string,
    t: Element,
    e: PointerEvent,
    rel: EventTarget | null = null,
  ) =>
    t.dispatchEvent(
      new PointerEvent(type, {
        bubbles: !['pointerenter', 'pointerleave'].includes(type),
        cancelable: true,
        clientX: x,
        clientY: y,
        screenX: e.screenX + x - e.clientX,
        screenY: e.screenY + y - e.clientY,
        button: e.button,
        buttons: e.buttons,
        pointerId: e.pointerId,
        pointerType: 'mouse',
        isPrimary: true,
        relatedTarget: rel,
      }),
    )
  let over = (e: PointerEvent) => {
    let next = target()
    if (next == hover) return
    let was = hover
    if (was) {
      was.classList.remove('Pointer-hover')
      point('pointerout', was, e, next)
      point('pointerleave', was, e, next)
      mouse('mouseout', was, e, next)
      mouse('mouseleave', was, e, next)
    }
    hover = next
    if (next) {
      next.classList.add('Pointer-hover')
      point('pointerover', next, e, was)
      point('pointerenter', next, e, was)
      mouse('mouseover', next, e, was)
      mouse('mouseenter', next, e, was)
    }
  }
  let range = (t: Element, end = false) => {
    let input = t.closest('input[type=range]')
    if (!(input instanceof HTMLInputElement)) return
    let r = input.getBoundingClientRect()
    let min = Number(input.min || 0), max = Number(input.max || 100)
    let step = Number(input.step || 1)
    let raw = min +
      (max - min) * Math.max(0, Math.min(1, (x - r.left) / r.width))
    let value = String(
      Math.min(
        max,
        Math.max(
          min,
          step > 0 ? min + Math.round((raw - min) / step) * step : raw,
        ),
      ),
    )
    if (input.value != value) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (end) input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  let release = () => {
    cursor.hidden = true
    if (hover) {
      hover.classList.remove('Pointer-hover')
      hover.dispatchEvent(
        new PointerEvent('pointerout', {
          bubbles: true,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      )
    }
    hover = down = clicked = null
    world = false
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType != 'mouse' || locked()) return
    x = e.clientX
    y = e.clientY
    // A browser requires this to be called during the gesture. A second
    // drag uses the same lock and never shows another lock notice.
    void stage.requestPointerLock().catch((error) => reportError(error))
  }, true)
  document.addEventListener('pointerlockchange', () => {
    if (!locked()) return release()
    cursor.hidden = false
    paint()
  })
  addEventListener('blur', () => {
    if (locked()) document.exitPointerLock()
    release()
  })
  addEventListener('keydown', (e) => {
    if (e.code == 'Escape' && locked()) document.exitPointerLock()
  }, true)
  addEventListener('resize', () => {
    x = clamp(x, innerWidth)
    y = clamp(y, innerHeight)
    paint()
  })

  document.addEventListener('pointermove', (e) => {
    if (!locked() || !e.isTrusted || e.pointerType != 'mouse') return
    x = clamp(x + e.movementX, innerWidth)
    y = clamp(y + e.movementY, innerHeight)
    far += Math.hypot(e.movementX, e.movementY)
    paint()
    over(e)
    let t = down ?? ui(target())
    if (t) {
      point('pointermove', t, e)
      mouse('mousemove', t, e)
      if (down) range(down)
      if (!world) e.stopPropagation()
    }
  }, true)
  document.addEventListener('pointerdown', (e) => {
    if (!locked() || !e.isTrusted || e.pointerType != 'mouse') return
    down = ui(target())
    world = !down
    far = 0
    if (!down) return
    point('pointerdown', down, e)
    mouse('mousedown', down, e)
    if (down instanceof HTMLLabelElement) down.control?.focus()
    else if (down instanceof HTMLElement) down.focus()
    range(down)
    e.stopPropagation()
  }, true)
  document.addEventListener('pointerup', (e) => {
    if (!locked() || !e.isTrusted || e.pointerType != 'mouse') return
    let t = down ?? (world ? null : ui(target()))
    clicked = down && far < 8 ? down : null
    down = null
    world = false
    if (!t) return
    point('pointerup', t, e)
    mouse('mouseup', t, e)
    range(t, true)
    e.stopPropagation()
  }, true)
  document.addEventListener('click', (e) => {
    if (!locked() || !e.isTrusted) return
    let t = clicked
    clicked = null
    if (!t) return
    e.stopPropagation()
    if (t.isConnected) mouse('click', t, e)
  }, true)
  document.addEventListener('wheel', (e) => {
    if (!locked() || !e.isTrusted) return
    let t = ui(target())
    if (!t) return
    e.preventDefault()
    e.stopPropagation()
    t.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
      }),
    )
    let scroller = t.closest<HTMLElement>('.Panel_Body')
    scroller?.scrollBy(e.deltaX, e.deltaY)
  }, { capture: true, passive: false })
  return { locked }
}
