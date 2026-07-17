import { type ComponentChildren, Fragment, h, render } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

// Overlays that must escape their container. Every card lives in the
// scaled/scrolled canvas plane, and every popover today is a
// position:absolute child clipped by an overflow ancestor — so tooltips
// and pickers get cut off. Two escapes are BOTH shut: CSS anchor() won't
// resolve inside a transformed ancestor (the plane), and position:fixed
// takes the transformed plane as its containing block, not the viewport.
//
// The one door out: getBoundingClientRect() already returns POST-transform
// VIEWPORT coordinates, so a node portaled into document.body and fixed at
// that rect lands on the trigger from anywhere in the plane — and renders
// at 1:1 whatever the zoom, which is the feature (a picker at zoom 0.4
// stays readable). We portal by hand with preact's own render() into a
// body-mounted host: no preact/compat, no react shim, ~one screen of code.

let MARGIN = 6 // keep this many px off every viewport edge
let GAP = 4 // between the trigger and the overlay

// Place a fixed element centered on the anchor rect's chosen edge, clamped
// horizontally into the viewport and flipped to the other side when the
// asked-for side has no room. Shared by <Overlay> and the tooltip.
export let place = (
  el: HTMLElement,
  rect: DOMRect,
  side: 'above' | 'below',
) => {
  let w = el.offsetWidth
  let h = el.offsetHeight
  let left = rect.left + rect.width / 2 - w / 2
  left = Math.max(MARGIN, Math.min(left, innerWidth - w - MARGIN))
  let above = rect.top - h - GAP
  let below = rect.bottom + GAP
  let top = side == 'above'
    ? (above >= MARGIN ? above : below)
    : (below + h <= innerHeight - MARGIN ? below : above)
  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

// <Overlay anchor={ref} side>{…}</Overlay> — renders its children into a
// fixed host on document.body, positioned on the anchor's live rect. The
// anchor is a REF (not an element): the child that owns it may mount in the
// same commit as this Overlay, so we read .current in the layout effect —
// after the DOM exists — not during render. The children keep their own
// focus/keys/state because render() into the same host diffs in place.
export let Overlay = (
  { anchor, side, children }: {
    anchor: { current: HTMLElement | null }
    side: 'above' | 'below'
    children: ComponentChildren
  },
) => {
  // No real browser (the TUI's fake document has no <body>) → a no-op: the
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
    render(h(Fragment, null, children), el)
    put(el)
  })

  return null
}

// The house tooltip, now ONE portaled node instead of a ::before on every
// [data-tip] host (which the overflow ancestors clipped). Delegated on the
// document: linger ~0.3s over a [data-tip], show it centered above, clamped;
// hide instantly on the pointer leaving or any press. The data-tip ATTRIBUTE
// contract is untouched — callers keep their attributes. Idempotent across
// hot-swaps via a globalThis latch (App.tsx's import graph re-runs on swap).
export let tips = () => {
  let g = globalThis as { document?: Document; __tips?: boolean }
  if (!g.document?.body || g.__tips) return // real browser only, once
  g.__tips = true

  let tip = document.createElement('div')
  tip.className = 'Tip'
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
