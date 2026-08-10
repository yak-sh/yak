import { type Signal, useComputed, useSignal } from '@preact/signals'
import { camera, ent, mutate, pinZ, toFront, topZ, unreadFor } from '../live.ts'
import { type Pinned } from '../types.ts'
import { block, el } from './ui.tsx'
import { applicable } from './registry.ts'
import { dragData } from './drag.ts'
import { Entity } from './Entity.tsx'
import { filterable, FilterInput } from './Filter.tsx'
import { Icon } from './icons.tsx'
import { cardMenuAt } from './nav.tsx'
import { overTray, shelf, shelfMint } from './Tray.tsx'

// Each tab view wears an icon; the name moves into an anchored tooltip.
// Exported: the fullscreen Screen bar (App.tsx) draws the same tabs.
export let icons: Record<string, string> = {
  Wake: 'alarm-clock',
  Canvas: 'map',
  List: 'list',
  Full: 'file-text',
  Board: 'kanban',
  Layout: 'columns-3',
  Persona: 'drama',
  Dashboard: 'layout-dashboard',
  Inbox: 'inbox',
  Role: 'bot',
  Web: 'globe',
  Session: 'bot',
  Markdown: 'hash',
  JSON: 'braces',
  Schema: 'shapes',
  Debug: 'bug',
}

let Badge = el('span', 'Tab_Badge')

// A tab's face: its icon, plus what is waiting behind it. Only the Inbox
// carries a count today, and it is the difference between a tab you check
// and one you remember to check. Shared by all three tab rows (card, peek,
// fullscreen) so a badge can never appear on one and not another.
export let TabFace = ({ view, eid }: { view: string; eid: string }) => {
  let n = view == 'Inbox' ? unreadFor(eid) : 0
  return (
    <>
      <Icon name={icons[view]} />
      {n > 0 && <Badge>{n > 99 ? '99+' : n}</Badge>}
    </>
  )
}

let Pin = el('div', 'Pin')
let Tab = el('button', 'Tab')
let Handle = el('div', 'Handle')

// Resize handles live in the Pin's padding ring around the card — every
// side and corner. Their name says which edges they move.
let handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
let Frame = block('section', 'Card', {
  Tabs: 'header',
  X: 'button',
  Scroll: 'div',
})
let { Tabs, X, Scroll } = Frame

export let pinStyle = (live: Signal<Pinned>) => {
  let p = live.value
  return `left:${p.x}px;top:${p.y}px;z-index:${pinZ(p.eid, p.z).value};` +
    (p.w ? `width:${p.w}px;` : '') +
    (p.h ? `height:${p.h}px;` : '')
}

// A card: one entity through one chosen view, framed by a tab per view that
// applies. Everything renders from the cache, so a tab click is just a card
// patch and a titlebar drag is pin patches — local first (instant), wire on
// drop. Tabs are native draggables: dropped on the canvas they spawn a new
// card with that view (Canvas owns the drop); dragged to the desktop they
// become a file when the view's renderer has a file form (the raw formats
// nested under Debug use the same drag contract).
// The scroller (not the card) owns the padding, so the scrollbar rides the
// card border and the padding scrolls away with the content.
export let Card = ({ p }: { p: Pinned }) => {
  // Plain props do not invalidate a computed signal. Mirror the latest pin
  // into one so moves update the style while z-only raises still bind
  // straight to the attribute without rerendering the card body.
  let live = useSignal(p)
  live.value = p
  let style = useComputed(() => pinStyle(live))
  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!(e.target instanceof Element)) return
    toFront(p.eid) // ANY touch raises the card — the drag gate is below
    if (e.button != 0) return // right/middle click is a menu, never a drag
    if (
      e.target.closest('button, a, input, [contenteditable="plaintext-only"]')
    ) {
      return // an editing title owns its clicks — place the cursor, no drag
    }
    if (!e.target.closest('.Card_Tabs')) return
    let el = e.currentTarget
    let from = { x: p.x, y: p.y }
    let sx = e.clientX
    let sy = e.clientY
    // A click is not a drag: capturing the pointer retargets the derived
    // mouse events (a title's dblclick would never fire), so the drag — and
    // the capture — only start once the pointer has really moved.
    let dragging = false
    // The drag is compositor-only: the pin rides the pointer on a
    // transform, and the GRAPH hears one pin patch on drop — a per-move
    // cache write would re-render every board row in the app per mouse
    // event.
    let dx = 0
    let dy = 0
    let px = 0 // last pointer position, in screen px — up() has no event
    let py = 0
    let move = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!dragging) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 3) return
        dragging = true
        el.setPointerCapture(e.pointerId)
        el.style.willChange = 'transform'
      }
      // Pointer deltas are screen px; the pin lives in plane px.
      let z = camera.value.zoom
      dx = (e.clientX - sx) / z
      dy = (e.clientY - sy) / z
      el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    // A dead gesture (pointercancel — touch-scroll takeover, etc.) snaps
    // the card back and patches nothing; only a pointerup commits.
    let quit = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', quit)
      el.style.transform = ''
      el.style.willChange = ''
    }
    let up = () => {
      quit()
      if (!dragging) return
      // Dropped over the Tray: the card leaves the canvas for the shelf
      // (minted on first use) rather than settling at a new x/y.
      if (overTray(px, py)) {
        let sh = shelf() ?? shelfMint()
        mutate({
          eid: p.eid,
          name: 'pin',
          comp: { canvas: sh, x: 0, y: 0, w: 0, h: 0, z: topZ(sh) + 1 },
        })
        return
      }
      mutate({
        eid: p.eid,
        name: 'pin',
        comp: { x: Math.round(from.x + dx), y: Math.round(from.y + dy) },
      })
    }
    // The listeners ride the WINDOW: until the capture engages, moves only
    // reach the element under the cursor, and a fast flick outruns the pin
    // before its first pointermove — the card wedges mid-drag. The window
    // can't be outrun.
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', quit)
  }

  // Drag a side or corner to size the card; west/north edges move the pin
  // so the opposite edge stays put. 0 means auto, so an auto dimension
  // starts from the rendered size the moment a resize grabs it.
  let resize = (
    e: PointerEvent & { currentTarget: HTMLDivElement },
    d: string,
  ) => {
    e.stopPropagation() // the grip's down never reaches the Pin's handler,
    toFront(p.eid) // so the grab raises the card here — same as any touch
    if (e.button != 0) return
    let grip = e.currentTarget
    let card = grip.parentElement!.querySelector('.Card') as HTMLElement
    let base = {
      x: p.x,
      y: p.y,
      w: p.w || card.offsetWidth,
      h: p.h || card.offsetHeight,
    }
    let sx = e.clientX
    let sy = e.clientY
    let comp: Record<string, number> = {}
    grip.setPointerCapture(e.pointerId)
    // Like the titlebar drag, the gesture rides inline styles — one pin
    // reflows per move, the graph hears one patch on release.
    let pin = grip.parentElement as HTMLElement
    let move = (e: PointerEvent) => {
      let z = camera.value.zoom
      let dx = (e.clientX - sx) / z
      let dy = (e.clientY - sy) / z
      comp = {}
      if (d.includes('e')) comp.w = Math.max(160, Math.round(base.w + dx))
      if (d.includes('w')) {
        comp.w = Math.max(160, Math.round(base.w - dx))
        comp.x = Math.round(base.x + base.w - comp.w)
      }
      if (d.includes('s')) comp.h = Math.max(60, Math.round(base.h + dy))
      if (d.includes('n')) {
        comp.h = Math.max(60, Math.round(base.h - dy))
        comp.y = Math.round(base.y + base.h - comp.h)
      }
      if (comp.x != null) pin.style.left = `${comp.x}px`
      if (comp.y != null) pin.style.top = `${comp.y}px`
      if (comp.w != null) pin.style.width = `${comp.w}px`
      if (comp.h != null) {
        pin.style.height = `${comp.h}px`
        pin.classList.add('Pin-sized')
      }
    }
    let up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      if (Object.keys(comp).length) mutate({ eid: p.eid, name: 'pin', comp })
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
  }

  // Double-click a side to revert that dimension to auto; a corner, both.
  let reset = (d: string) => {
    let comp: Record<string, number> = {}
    if (d.includes('e') || d.includes('w')) comp.w = 0
    if (d.includes('n') || d.includes('s')) comp.h = 0
    mutate({ eid: p.eid, name: 'pin', comp })
  }

  return (
    <Pin
      mod={[p.h ? 'sized' : false, !p.w && 'auto']}
      data-eid={p.eid}
      style={style}
      onPointerDown={down}
      // The CARD is the right-click target — "open here" (make this the
      // root card) and "open in new tab" for its target. Links, inputs,
      // and selectable text keep the browser's own menu.
      onContextMenu={cardMenuAt(ent(p.target))}
    >
      <Frame>
        <Tabs>
          <Entity eid={p.target} view='Card.Title' />
          {filterable.has(p.view) && <FilterInput eid={p.target} />}
          {applicable(ent(p.target)).map((v) => (
            <Tab
              type='button'
              mod={v == p.view && 'on'}
              draggable
              onDragStart={(e: DragEvent) => dragData(e, p.target, v, p.w)}
              onClick={() =>
                v != p.view &&
                mutate({ eid: p.eid, name: 'card', comp: { view: v } })}
              key={v}
              aria-label={v}
              data-tip={v}
            >
              <TabFace view={v} eid={p.target} />
            </Tab>
          ))}
          <X
            type='button'
            onClick={() => mutate({ eid: p.eid, name: 'entity', comp: null })}
          >
            ×
          </X>
        </Tabs>
        <Scroll>
          {
            /* The frame's ask wears the Card qualifier: a view with a card
              face (Card.Full) serves it, anything else walks to the plain
              role — the titlebar above already shows the head. */
          }
          <Entity eid={p.target} view={`Card.${p.view}`} />
        </Scroll>
      </Frame>
      {handles.map((d) => (
        <Handle
          key={d}
          mod={d}
          onPointerDown={(
            e: PointerEvent & { currentTarget: HTMLDivElement },
          ) => resize(e, d)}
          onDblClick={() => reset(d)}
        />
      ))}
    </Pin>
  )
}
