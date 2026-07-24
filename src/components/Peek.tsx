import { useLayoutEffect, useRef } from 'preact/hooks'
import { ent, mutate, toPlane, topZ, uuid } from '../live.ts'
import { block } from './ui.tsx'
import { peek, screenTarget } from './nav.tsx'
import { resolve } from './registry.ts'
import { Entity } from './Entity.tsx'
import { place } from './overlay.tsx'

// The Peek: what a clicked link opens on desktop — a temporary card in a
// popover just above the pointer, clamped to the viewport (overlay.tsx
// place). Reading is free; the first pointerdown INSIDE adopts the card
// onto the canvas right where the popover floats — and closing waits for
// that click to finish, so the interaction that pinned it still lands.
// Esc, q, or a click anywhere else dismisses it unpinned.

let Frame = block('div', 'Peek', { Head: 'div', Body: 'div' })
let { Head, Body } = Frame

export let Peek = () => {
  let p = peek.value
  let root = useRef<HTMLDivElement>(null)
  let done = useRef(false)

  useLayoutEffect(() => {
    if (!p) return
    done.current = false
    let el = root.current!
    let anchor = new DOMRect(p.x - 8, p.y - 8, 16, 16)
    let put = () => place(el, anchor, 'above')
    put()
    let ro = new ResizeObserver(put)
    ro.observe(el)
    let away = (ev: PointerEvent) => {
      // popout editors portal into a body-mounted .Overlay (overlay.tsx),
      // so containment can't see them — pressing one is USING the peek,
      // and dismissing here would unmount the control before its click.
      if (
        ev.target instanceof Element && !el.contains(ev.target) &&
        !ev.target.closest('.Overlay')
      ) peek.value = null
    }
    let key = (ev: KeyboardEvent) => {
      let typing = ev.target instanceof HTMLElement &&
        ev.target.matches('input, textarea, [contenteditable]')
      if (ev.key == 'Escape' || (ev.key == 'q' && !typing)) {
        ev.stopPropagation()
        peek.value = null
      }
    }
    addEventListener('pointerdown', away)
    addEventListener('keydown', key, true)
    return () => {
      ro.disconnect()
      removeEventListener('pointerdown', away)
      removeEventListener('keydown', key, true)
    }
  }, [p])

  if (!p) return null
  let e = ent(p.eid)

  // The first interaction adopts: a card+pin minted where the popover
  // floats, top of the stack. A root with no canvas has nowhere to pin,
  // so the peek just stays a peek there.
  let adopt = () => {
    if (done.current) return
    let t = screenTarget()
    let box = document.querySelector('.Canvas')?.getBoundingClientRect()
    if (!t || !box || !ent(t.eid).canvas) return
    done.current = true
    let r = root.current!.getBoundingClientRect()
    let at = toPlane(r.left, r.top, box)
    let card = uuid()
    mutate(
      {
        eid: card,
        name: 'card',
        comp: { eid: card, target_eid: p!.eid, view: resolve(e).view },
      },
      {
        eid: card,
        name: 'pin',
        comp: {
          eid: card,
          canvas_eid: t.eid,
          x: Math.round(at.x),
          y: Math.round(at.y),
          w: 0,
          h: 0,
          z: topZ(t.eid) + 1,
        },
      },
    )
    // the click that pinned us finishes in the popover, then it yields
    // to the real card underneath
    addEventListener('pointerup', () => {
      setTimeout(() => (peek.value = null), 60)
    }, { once: true })
  }

  return (
    <Frame elRef={root} onPointerDown={adopt}>
      <Head>
        <Entity eid={p.eid} view='Card.Title' />
      </Head>
      <Body>
        <Entity eid={p.eid} view={`Card.${resolve(e).view}`} />
      </Body>
    </Frame>
  )
}
