import { applyLocal, camera, ent, mutate, send, topZ } from '../live.ts'
import { type Pinned } from '../types.ts'
import { block, el } from './ui.tsx'
import { applicable, dragData, View } from './View.tsx'

let Pin = el('div', 'Pin')
let Tab = el('button', 'Tab')
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
    if (e.target.closest('button, a, input')) return
    if (!e.target.closest('.Card_Tabs')) return
    let el = e.currentTarget
    let from = { x: p.x, y: p.y }
    let sx = e.clientX
    let sy = e.clientY
    let top = topZ(p.canvas_eid)
    if (p.z != top) mutate({ eid: p.eid, name: 'pin', comp: { z: top + 1 } })
    el.setPointerCapture(e.pointerId)
    let move = (e: PointerEvent) => {
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
      let pin = ent(p.eid).pin!
      send({ eid: p.eid, name: 'pin', comp: { x: pin.x, y: pin.y } })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <Pin
      style={`left:${p.x}px;top:${p.y}px;z-index:${p.z};` +
        (p.w ? `width:${p.w}px;` : '')}
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
            >
              {v}
            </Tab>
          ))}
          <View eid={p.target_eid} view='Id' />
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
    </Pin>
  )
}
