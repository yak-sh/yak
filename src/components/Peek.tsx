import { useLayoutEffect, useRef } from 'preact/hooks'
import { ent } from '../live.ts'
import { block, el } from './ui.tsx'
import { peek } from './nav.tsx'
import { applicable, resolve } from './registry.ts'
import { dragData } from './drag.ts'
import { Entity } from './Entity.tsx'
import { icons } from './Card.tsx'
import { Icon } from './icons.tsx'
import { place } from './overlay.tsx'

// The Peek: what a clicked link opens on desktop — a temporary card in a
// popover just above the pointer, clamped to the viewport (overlay.tsx
// place). Reading AND clicking are free; the head is a titlebar — view
// tabs like a card's, and the drag handle. Dragging it onto the canvas
// PINS the peek (the standard card payload; Canvas owns the drop), and a
// landed drop closes it — the card it became is on the canvas now. Esc,
// q, or a click anywhere else dismisses it unpinned.

let Frame = block('div', 'Peek', { Head: 'div', Body: 'div' })
let { Head, Body } = Frame
let Tab = el('button', 'Tab')

export let Peek = () => {
  let p = peek.value
  let root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!p) return
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
  let tabs = applicable(e)
  let view = p.view && tabs.includes(p.view) ? p.view : resolve(e).view

  // Every drag out of the head ends here (dragend bubbles): a landed
  // drop means the peek lives on the canvas now, so it closes; a
  // cancelled drag keeps it floating.
  let flown = (ev: DragEvent) => {
    if (ev.dataTransfer?.dropEffect != 'none') peek.value = null
  }

  return (
    <Frame elRef={root}>
      <Head
        draggable
        onDragStart={(ev: DragEvent) => dragData(ev, p!.eid, view)}
        onDragEnd={flown}
      >
        <Entity eid={p.eid} view='Card.Title' />
        {tabs.map((v) => (
          <Tab
            type='button'
            mod={v == view && 'on'}
            draggable
            // a tab flies its OWN view: stop the head's dragstart from
            // overwriting the payload with the current one
            onDragStart={(ev: DragEvent) => {
              ev.stopPropagation()
              dragData(ev, p!.eid, v)
            }}
            onClick={() => v != view && (peek.value = { ...p!, view: v })}
            key={v}
            aria-label={v}
            data-tip={v}
          >
            <Icon name={icons[v]} />
          </Tab>
        ))}
      </Head>
      <Body>
        <Entity eid={p.eid} view={`Card.${view}`} />
      </Body>
    </Frame>
  )
}
