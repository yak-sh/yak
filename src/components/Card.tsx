import { applyLocal, camera, ent, mutate, send, topZ } from '../live.ts'
import { type Pinned } from '../types.ts'
import { block, el } from './ui.tsx'
import { applicable, dragData, View } from './View.tsx'
import { Icon } from './icons.tsx'

// Each tab view wears an icon; the name moves into an anchored tooltip.
let icons: Record<string, string> = {
  Task: 'square-check',
  Board: 'kanban',
  Doc: 'file-text',
  Web: 'globe',
  MD: 'hash',
  JSON: 'braces',
  Debug: 'search',
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

// A card: one entity through one chosen view, framed by a tab per view that
// applies. Everything renders from the cache, so a tab click is just a card
// patch and a titlebar drag is pin patches — local first (instant), wire on
// drop. Tabs are native draggables: dropped on the canvas they spawn a new
// card with that view (Canvas owns the drop); dragged to the desktop they
// become a file when the view's renderer has a file form (JSON, MD).
// The scroller (not the card) owns the padding, so the scrollbar rides the
// card border and the padding scrolls away with the content.
export let Card = ({ p }: { p: Pinned }) => {
  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!(e.target instanceof Element)) return
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
    let top = topZ(p.canvas_eid)
    if (p.z != top) mutate({ eid: p.eid, name: 'pin', comp: { z: top + 1 } })
    // A click is not a drag: capturing the pointer retargets the derived
    // mouse events (a title's dblclick would never fire), so the drag — and
    // the capture — only start once the pointer has really moved.
    let dragging = false
    let move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 3) return
        dragging = true
        el.setPointerCapture(e.pointerId)
      }
      // Pointer deltas are screen px; the pin lives in plane px.
      let z = camera.value.zoom
      applyLocal([{
        eid: p.eid,
        name: 'pin',
        comp: {
          x: Math.round(from.x + (e.clientX - sx) / z),
          y: Math.round(from.y + (e.clientY - sy) / z),
        },
      }])
    }
    let up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      if (!dragging) return
      let pin = ent(p.eid).pin!
      send({ eid: p.eid, name: 'pin', comp: { x: pin.x, y: pin.y } })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  // Drag a side or corner to size the card; west/north edges move the pin
  // so the opposite edge stays put. 0 means auto, so an auto dimension
  // starts from the rendered size the moment a resize grabs it.
  let resize = (
    e: PointerEvent & { currentTarget: HTMLDivElement },
    d: string,
  ) => {
    e.stopPropagation()
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
      applyLocal([{ eid: p.eid, name: 'pin', comp }])
    }
    let up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      if (Object.keys(comp).length) send({ eid: p.eid, name: 'pin', comp })
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
      mod={p.h ? 'sized' : false}
      style={`left:${p.x}px;top:${p.y}px;z-index:${p.z};` +
        (p.w ? `width:${p.w}px;` : '') +
        (p.h ? `height:${p.h}px;` : '')}
      onPointerDown={down}
    >
      <Frame>
        <Tabs>
          <View eid={p.target_eid} view='Card.Title' />
          {applicable(ent(p.target_eid)).map((v) => (
            <Tab
              type='button'
              mod={v == p.view && 'on'}
              draggable
              onDragStart={(e: DragEvent) => dragData(e, p.target_eid, v, p.w)}
              onClick={() =>
                v != p.view &&
                mutate({ eid: p.eid, name: 'card', comp: { view: v } })}
              key={v}
              aria-label={v}
            >
              <Icon name={icons[v]} />
              <span class='Tab_Tip'>{v}</span>
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
          <View eid={p.target_eid} view={p.view} context='Card' />
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
