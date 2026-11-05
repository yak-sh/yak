// A reader steering a drawing in a page: a pinch (two fingers, or a trackpad,
// which a browser reports as a wheel with ctrl held) or ctrl-scroll zooms
// about where it happens, and a drag pans once zoomed in. Plain scrolling
// still scrolls the page, one finger on a drawing seen whole scrolls it too,
// and the click that ends a drag is not a click. The views come from view.ts;
// this only reads the gestures.
import type { Layout } from './layout.ts'
import { pan, type View, zoom, zoomed } from './view.ts'

/** What a drawing being steered is asked and told. */
export type Steering = {
  /** The layout drawn, once there is one. */
  layout: () => Layout | undefined
  view: () => View
  /** Show another part of the sheet. */
  set: (view: View) => void
}

type Pointer = { pointerId: number; clientX: number; clientY: number }

// How far a pointer moves before it is a drag, in pixels.
const SLOP = 4

/** Follow a reader's gestures on `el`, which holds the drawing's `<svg>`;
 * returns what stops following them. */
export let steer = (el: HTMLElement, s: Steering): () => void => {
  let down = new Map<number, [number, number]>()
  let moved = 0
  // Where a point on the screen is, as fractions of the view, and how many
  // sheet units a pixel is: the drawing is fitted into its box, centred. A
  // box with no size, as outside a laid out page, is a unit a pixel.
  let frame = () => {
    let box = (el.querySelector('svg') ?? el).getBoundingClientRect()
    let [, , w, h] = s.view()
    let bw = box.width || w, bh = box.height || h
    let k = Math.max(w / bw, h / bh)
    return {
      k,
      at: (cx: number, cy: number): [number, number] => [
        (cx - box.left - (bw - w / k) / 2) * k / w,
        (cy - box.top - (bh - h / k) / 2) * k / h,
      ],
    }
  }
  let touch = () => {
    let l = s.layout()
    let deep = !!l && zoomed(l, s.view())
    el.style.touchAction = deep ? 'none' : 'pan-x pan-y'
    el.classList.toggle('is-zoomed', deep)
  }
  let set = (v: View) => (s.set(v), touch())
  let wheel = (e: WheelEvent) => {
    let l = s.layout()
    if (!e.ctrlKey || !l) return
    e.preventDefault()
    let k = Math.exp(-e.deltaY * .01)
    set(zoom(l, s.view(), k, frame().at(e.clientX, e.clientY)))
  }
  let pressed = (e: Pointer) => {
    down.set(e.pointerId, [e.clientX, e.clientY])
    if (down.size == 1) moved = 0
  }
  let move = (e: Pointer) => {
    let l = s.layout(), was = down.get(e.pointerId)
    if (!l || !was) return
    let pts = [...down.values()]
    let mid = (ps: [number, number][]) =>
      ps.reduce(([x, y], [a, b]) => [x + a / ps.length, y + b / ps.length], [
        0,
        0,
      ])
    let [ox, oy] = mid(pts)
    let spread = pts.length == 2
      ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])
      : 0
    down.set(e.pointerId, [e.clientX, e.clientY])
    pts = [...down.values()]
    let [nx, ny] = mid(pts)
    moved += Math.hypot(e.clientX - was[0], e.clientY - was[1])
    let { k, at } = frame()
    let v = s.view()
    if (pts.length == 2) {
      let now = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])
      v = zoom(l, v, now / (spread || now), at(nx, ny))
    } else if (!zoomed(l, v)) return
    set(pan(l, v, (ox - nx) * k, (oy - ny) * k))
  }
  let up = (e: Pointer) => void down.delete(e.pointerId)
  // A click that ends a drag or a pinch moved the drawing; it opens nothing.
  let click = (e: Event) => {
    if (moved <= SLOP) return
    e.stopImmediatePropagation()
    e.preventDefault()
    moved = 0
  }
  let on: [string, EventListener, AddEventListenerOptions?][] = [
    ['wheel', wheel as EventListener, { passive: false }],
    ['pointerdown', pressed as unknown as EventListener],
    ['pointermove', move as unknown as EventListener],
    ['pointerup', up as unknown as EventListener],
    ['pointercancel', up as unknown as EventListener],
    ['click', click, { capture: true }],
  ]
  for (let [type, fn, opts] of on) el.addEventListener(type, fn, opts)
  touch()
  return () => {
    for (let [type, fn, opts] of on) el.removeEventListener(type, fn, opts)
  }
}
