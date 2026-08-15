// The drag payload, view-free. This lives OUTSIDE Entity.tsx so nav.tsx
// (which every view imports for linkProps) never pulls the curated view
// list into a cycle: views/Inline.tsx → nav.tsx → Entity.tsx → views/Inline.tsx
// was a TDZ time bomb — whichever module entered the cycle first left
// Entity.tsx's top-level define() list reading an uninitialized view
// binding under hot-swap re-evaluation. Native payloads and pointer geometry
// belong with the interaction machinery, not the views that consume them.
import { idOf } from '../types.ts'
import { ent } from '../live.ts'
import { resolve } from './registry.ts'

export type Box = { x: number; y: number; w: number; h: number }

export let resizeDirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export let moved = (x: number, y: number, dx: number, dy: number) => ({
  x: Math.round(x + dx),
  y: Math.round(y + dy),
})

export let sized = (base: Box, d: string, dx: number, dy: number) => {
  let next: Partial<Box> = {}
  if (d.includes('e')) next.w = Math.max(160, Math.round(base.w + dx))
  if (d.includes('w')) {
    next.w = Math.max(160, Math.round(base.w - dx))
    next.x = Math.round(base.x + base.w - next.w)
  }
  if (d.includes('s')) next.h = Math.max(60, Math.round(base.h + dy))
  if (d.includes('n')) {
    next.h = Math.max(60, Math.round(base.h - dy))
    next.y = Math.round(base.y + base.h - next.h)
  }
  return next
}

export let resetSize = (d: string) => ({
  ...(d.includes('e') || d.includes('w') ? { w: 0 } : {}),
  ...(d.includes('n') || d.includes('s') ? { h: 0 } : {}),
})

// Pointer geometry is shared by persistent Pins and temporary Peeks. The
// element previews locally; its owner decides where the one settle write goes.
export let moveEl = (
  e: PointerEvent,
  el: HTMLElement,
  scale: () => number,
  start: () => void,
  settle: (dx: number, dy: number, x: number, y: number) => void,
  cancel: () => void = () => {},
) => {
  let sx = e.clientX
  let sy = e.clientY
  let dx = 0
  let dy = 0
  let px = 0
  let py = 0
  let dragging = false
  let move = (e: PointerEvent) => {
    px = e.clientX
    py = e.clientY
    if (!dragging) {
      if (Math.hypot(px - sx, py - sy) < 3) return
      dragging = true
      start()
      el.setPointerCapture(e.pointerId)
      el.style.willChange = 'transform'
    }
    let z = scale()
    dx = (px - sx) / z
    dy = (py - sy) / z
    el.style.transform = `translate(${dx}px, ${dy}px)`
  }
  let quit = () => {
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', dead)
    el.style.transform = ''
    el.style.willChange = ''
  }
  let dead = () => {
    quit()
    cancel()
  }
  let up = () => {
    quit()
    if (dragging) settle(dx, dy, px, py)
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', dead)
}

export let resizeEl = (
  e: PointerEvent,
  grip: HTMLElement,
  el: HTMLElement,
  base: Box,
  d: string,
  scale: () => number,
  settle: (box: Partial<Box>) => void,
  cancel: () => void = () => {},
) => {
  let sx = e.clientX
  let sy = e.clientY
  let next: Partial<Box> = {}
  let before = {
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    height: el.style.height,
  }
  grip.setPointerCapture(e.pointerId)
  let move = (e: PointerEvent) => {
    let z = scale()
    next = sized(base, d, (e.clientX - sx) / z, (e.clientY - sy) / z)
    if (next.x != null) el.style.left = `${next.x}px`
    if (next.y != null) el.style.top = `${next.y}px`
    if (next.w != null) el.style.width = `${next.w}px`
    if (next.h != null) el.style.height = `${next.h}px`
  }
  let quit = () => {
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', dead)
  }
  let dead = () => {
    quit()
    Object.assign(el.style, before)
    cancel()
  }
  let up = () => {
    quit()
    if (Object.keys(next).length) settle(next)
    else cancel()
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', dead)
}

let b64 = (t: string) =>
  btoa(
    Array.from(new TextEncoder().encode(t), (b) => String.fromCharCode(b))
      .join(''),
  )

// Arm a dragstart with the standard payload: the spawn card (for a canvas
// drop — target + view + width, plus where in the dragged element the grab
// happened, so the spawned card lands where the ghost was dropped), and,
// when the view's renderer has a file form, the serialized file (for a
// desktop drop) plus text for editors. `pin` rides only for an EXISTING
// card being relocated (a Tray row dragged out): its presence says MOVE
// this pin, not clone a new card — tab drags omit it, so they still clone.
export let dragData = (
  ev: DragEvent,
  eid: string,
  view: string,
  w = 0,
  pin?: string,
) => {
  if (!ev.dataTransfer || !(ev.currentTarget instanceof HTMLElement)) return
  let e = ent(eid)
  let box = ev.currentTarget.getBoundingClientRect()
  ev.dataTransfer.setData(
    'application/x-tasks-card',
    JSON.stringify({
      target: eid,
      view,
      w,
      ox: ev.clientX - box.left,
      oy: ev.clientY - box.top,
      ...(pin ? { pin } : {}),
    }),
  )
  let f = resolve(e, view).file
  if (!f) return
  let text = f.text(e)
  ev.dataTransfer.setData('text/plain', text)
  ev.dataTransfer.setData(
    'DownloadURL',
    `${f.mime}:${idOf(e)}.${f.ext}:data:${f.mime};base64,${b64(text)}`,
  )
}
