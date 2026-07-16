import { applyLocal, camera, ent, mutate, send, topZ } from '../live.ts'
import { type Pinned } from '../types.ts'
import { el } from './ui.tsx'
import { applicable, resolve, View } from './View.tsx'
import { idOf } from './views/Id.tsx'

let Pin = el('div', 'Pin')
let Frame = el('section', 'Card')
let Tabs = el('header', 'Card_Tabs')
let X = el('button', 'Card_X')
let Tab = el('button', 'Tab')
let Scroll = el('div', 'Card_Scroll')

let b64 = (t: string) =>
  btoa(
    Array.from(new TextEncoder().encode(t), (b) => String.fromCharCode(b))
      .join(''),
  )

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

  // A dragged tab carries the spawn payload (for a canvas drop) and, when
  // the view has a file form, the serialized file (for a desktop drop).
  let drag = (e: DragEvent, view: string) => {
    if (!e.dataTransfer) return
    let target = ent(p.target_eid)
    e.dataTransfer.setData(
      'application/x-tasks-card',
      JSON.stringify({ target_eid: p.target_eid, view, w: p.w }),
    )
    let f = resolve(target, view).file
    if (!f) return
    let text = f.text(target)
    e.dataTransfer.setData('text/plain', text)
    e.dataTransfer.setData(
      'DownloadURL',
      `${f.mime}:${idOf(target)}.${f.ext}:data:${f.mime};base64,${b64(text)}`,
    )
  }

  return (
    <Pin
      style={`left:${p.x}px;top:${p.y}px;z-index:${p.z};` +
        (p.w ? `width:${p.w}px;` : '')}
      onPointerDown={down}
    >
      <Frame>
        <Tabs>
          <X
            type='button'
            onClick={() => mutate({ eid: p.eid, name: 'entity', comp: null })}
          >
            ×
          </X>
          {applicable(ent(p.target_eid)).map((v) => (
            <Tab
              type='button'
              mod={v == p.view && 'on'}
              draggable
              onDragStart={(e: DragEvent) => drag(e, v)}
              onClick={() =>
                v != p.view &&
                mutate({ eid: p.eid, name: 'card', comp: { view: v } })}
              key={v}
            >
              {v}
            </Tab>
          ))}
        </Tabs>
        <Scroll>
          <View eid={p.target_eid} view={p.view} />
        </Scroll>
      </Frame>
    </Pin>
  )
}
