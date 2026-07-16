import { applyLocal, camera, ent, mutate, send } from '../live.ts'
import { type Pinned } from '../types.ts'
import { applicable, View } from './View.tsx'

// A card: one entity through one chosen lens, framed by a tab per matching
// lens. Everything renders from the cache, so a tab click is just a card
// patch and a drag is pin patches — local first (instant), wire on drop.
// Only the titlebar drags, and its buttons still click. The scroller (not
// the card) owns the padding, so the scrollbar rides the card border and
// the padding scrolls away with the content.
export let Card = ({ p }: { p: Pinned }) => {
  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (!(e.target instanceof Element)) return
    if (e.target.closest('button, a, input')) return
    if (!e.target.closest('.Card_Tabs')) return
    let el = e.currentTarget
    let from = { x: p.x, y: p.y }
    let sx = e.clientX
    let sy = e.clientY
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
    <div
      class='Pin'
      style={`left:${p.x}px;top:${p.y}px;` + (p.w ? `width:${p.w}px;` : '')}
      onPointerDown={down}
    >
      <section class='Card'>
        <header class='Card_Tabs'>
          {applicable(ent(p.target_eid)).map((v) => (
            <button
              type='button'
              class={v.id == p.view ? 'Tab Tab-on' : 'Tab'}
              onClick={() =>
                v.id != p.view &&
                mutate({ eid: p.eid, name: 'card', comp: { view: v.id } })}
              key={v.id}
            >
              {v.id}
            </button>
          ))}
        </header>
        <div class='Card_Scroll'>
          <View eid={p.target_eid} view={p.view} />
        </div>
      </section>
    </div>
  )
}
