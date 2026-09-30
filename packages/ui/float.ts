/**
 * What floats, in a browser: the popover primitive (D-58967), whose terminal
 * form is the flow itself. A card on web's canvas lives in a scaled and
 * scrolled plane, and a position:absolute popover is clipped by any overflow
 * ancestor, so tooltips and pickers get cut off. Two escapes are both shut:
 * CSS anchor() won't resolve inside a transformed ancestor (the plane), and
 * position:fixed takes the transformed plane as its containing block, not the
 * viewport.
 *
 * The one door out: getBoundingClientRect() already returns post-transform
 * viewport coordinates, so a node portaled into document.body and fixed at
 * that rect lands on the trigger from anywhere in the plane, and renders at
 * 1:1 whatever the zoom, which is the feature (a picker at zoom 0.4 stays
 * readable). We portal by hand with preact's own render() into a
 * body-mounted `Overlay`, carrying the context of the tree it springs from, so
 * what floats reads the same providers as what stayed.
 *
 * - `Float`: children floated beside an anchor.
 * - `place`, `placeAt`, `usePlaceAt`: a fixed element put on a rect or a
 *   point, clamped to the viewport.
 * - `tips`: the house tooltip, for every `[data-tip]`.
 *
 * @module
 */

import {
  type ComponentChildren,
  Fragment,
  type FunctionComponent,
  h,
  render,
} from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

let MARGIN = 6 // keep this many px off every viewport edge
let GAP = 4 // between the trigger and the overlay

/** Place a fixed element centered on the anchor rect's chosen edge, clamped
 * into the viewport and flipped when only the other side has room: a
 * `Float`, and the tooltip. */
export let place = (
  el: HTMLElement,
  rect: DOMRect,
  side: 'above' | 'below',
): void => {
  let w = el.offsetWidth
  let h = el.offsetHeight
  let left = rect.left + rect.width / 2 - w / 2
  left = Math.max(MARGIN, Math.min(left, innerWidth - w - MARGIN))
  let above = rect.top - h - GAP
  let below = rect.bottom + GAP
  let fits = (top: number) => top >= MARGIN && top + h <= innerHeight - MARGIN
  let [first, second] = side == 'above' ? [above, below] : [below, above]
  let top = fits(first) ? first : fits(second) ? second : first
  top = Math.max(MARGIN, Math.min(top, innerHeight - h - MARGIN))
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

/** Put a fixed element at a point (a context menu, a form): its left edge
 * there, or its right edge for align 'right', its top just below, flipped
 * above when below has no room, clamped like `place`. */
export let placeAt = (
  el: HTMLElement,
  x: number,
  y: number,
  align?: 'right',
): void => {
  let w = el.offsetWidth
  let h = el.offsetHeight
  let left = align == 'right' ? x - w : x
  left = Math.max(MARGIN, Math.min(left, innerWidth - w - MARGIN))
  let fits = (top: number) => top >= MARGIN && top + h <= innerHeight - MARGIN
  let top = fits(y) ? y : fits(y - h) ? y - h : y
  top = Math.max(MARGIN, Math.min(top, innerHeight - h - MARGIN))
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

/** `placeAt` as a hook: placed after mount, and again whenever the box
 * resizes, since a popover's height is not known until it renders. */
export let usePlaceAt = (
  ref: { current: HTMLElement | null },
  at: { x: number; y: number; align?: 'right' } | null,
): void =>
  useLayoutEffect(() => {
    let el = ref.current
    if (!el || !at) return
    let put = () => placeAt(el, at.x, at.y, at.align)
    put()
    let ro = new ResizeObserver(put)
    ro.observe(el)
    return () => ro.disconnect()
  }, [at])

// A separate render root starts with no context. Preact hands a component
// the context of the tree it is in as its second argument, and a component
// that gives `getChildContext` hands that on to its children: the same carry
// preact/compat's portal makes.
function Carry(
  this: { getChildContext?: () => unknown },
  { context, children }: { context: unknown; children?: ComponentChildren },
) {
  this.getChildContext = () => context
  return h(Fragment, null, children)
}

/** What a `Float` is drawn with: the element it springs from, as a ref, and
 * which side of it to float on first. */
export type FloatProps = {
  anchor: { current: HTMLElement | null }
  side?: 'above' | 'below'
  children?: ComponentChildren
}

/**
 * `<Float anchor={ref} side>{…}</Float>` renders its children into a fixed
 * `Overlay` on document.body, positioned on the anchor's live rect. The
 * anchor is a ref, not an element: the child that owns it may mount in the
 * same commit as this Float, so `.current` is read in the layout effect,
 * after the DOM exists. The children keep their own focus, keys and state,
 * because render() into the same host diffs in place.
 */
export let Float: FunctionComponent<FloatProps> = (
  { anchor, side = 'above', children },
  context,
): null => {
  // No real browser (a terminal's document has no <body>) → a no-op: the
  // hooks still run (rules of hooks), but there's nothing to portal into.
  let host = useRef<HTMLDivElement>()
  if (!host.current && globalThis.document?.body) {
    host.current = document.createElement('div')
    host.current.className = 'Overlay'
  }

  let put = (el: HTMLElement) =>
    anchor.current && place(el, anchor.current.getBoundingClientRect(), side)

  // Live for the life of the component: attach on mount, tear the portal
  // down on unmount (render(null) runs the children's own cleanup first). A
  // ResizeObserver re-places when the CHILDREN resize — a picker's list
  // grows in its own render root, which the parent never hears — and a
  // window resize re-places too. We don't chase scroll: the trigger's own
  // blur/selection closes an overlay before that matters.
  useLayoutEffect(() => {
    let el = host.current
    if (!el) return
    document.body.appendChild(el)
    let ro = new ResizeObserver(() => put(el))
    ro.observe(el)
    let onResize = () => put(el)
    addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      removeEventListener('resize', onResize)
      render(null, el)
      el.remove()
    }
  }, [])

  // Every commit: repaint the children (new props from the parent) and
  // re-place, so an anchor that moved is tracked immediately.
  useLayoutEffect(() => {
    let el = host.current
    if (!el) return
    render(h(Carry, { context }, children), el)
    put(el)
  })

  return null
}

/** The house tooltip, one portaled `Tip` instead of a ::before on every
 * [data-tip] host (which the overflow ancestors clipped). Delegated on the
 * document: linger ~0.3s over a [data-tip], show it centered above, clamped;
 * hide instantly on the pointer leaving or any press. Once per page, through
 * a globalThis latch. */
export let tips = (): void => {
  let g = globalThis as { document?: Document; __tips?: boolean }
  if (!g.document?.body || g.__tips) return // real browser only, once
  g.__tips = true

  let tip = document.createElement('div')
  tip.className = 'Overlay Tip' // floated like any overlay, dressed as a Tip
  let host: Element | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  let hide = () => {
    if (timer) clearTimeout(timer)
    tip.remove()
    host = null
  }

  document.addEventListener('pointerover', (e) => {
    let next = (e.target as Element)?.closest?.('[data-tip]') ?? null
    if (next == host) return
    if (timer) clearTimeout(timer)
    tip.remove()
    host = next
    if (!next) return
    timer = setTimeout(() => {
      if (host != next) return
      tip.textContent = next.getAttribute('data-tip') ?? ''
      document.body.appendChild(tip)
      place(tip, next.getBoundingClientRect(), 'above')
    }, 300)
  })
  // A press anywhere kills the tooltip at once — no linger over a click.
  document.addEventListener('pointerdown', hide, true)
}
