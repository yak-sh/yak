import { useRef } from 'preact/hooks'
import {
  applyLocal,
  camera,
  ent,
  mutate,
  send,
  toPlane,
  topZ,
  uuid,
} from '../live.ts'
import { type Pinned } from '../types.ts'
import { applicable, View } from './View.tsx'

// A card: one entity through one chosen lens, framed by a tab per matching
// lens. Everything renders from the cache, so a tab click is just a card
// patch and a drag is pin patches — local first (instant), wire on drop.
// Grabbing the titlebar raises the card to the top; dragging a TAB tears it
// off into a new card showing that view (a plain click still switches).
// The scroller (not the card) owns the padding, so the scrollbar rides the
// card border and the padding scrolls away with the content.
export let Card = ({ p }: { p: Pinned }) => {
  let torn = useRef(false) // a tab drag just spawned — swallow its click

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

  // Tear a view tab off into its own card: past a small threshold, mint a
  // card + pin under the cursor and let the drag carry it until drop.
  let tear = (e: PointerEvent, view: string) => {
    let btn = e.currentTarget as HTMLElement
    let canvas = btn.closest('.Canvas')
    if (!canvas) return
    let sx = e.clientX
    let sy = e.clientY
    let spawned = ''
    btn.setPointerCapture(e.pointerId)
    let move = (e: PointerEvent) => {
      let at = toPlane(e.clientX, e.clientY, canvas.getBoundingClientRect())
      if (!spawned) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return
        spawned = uuid()
        applyLocal([
          {
            eid: spawned,
            name: 'card',
            comp: { eid: spawned, target_eid: p.target_eid, view },
          },
          {
            eid: spawned,
            name: 'pin',
            comp: {
              eid: spawned,
              canvas_eid: p.canvas_eid,
              x: Math.round(at.x - 24),
              y: Math.round(at.y - 12),
              w: p.w,
              h: 0,
              z: topZ(p.canvas_eid) + 1,
            },
          },
        ])
        return
      }
      applyLocal([{
        eid: spawned,
        name: 'pin',
        comp: { x: Math.round(at.x - 24), y: Math.round(at.y - 12) },
      }])
    }
    let up = () => {
      btn.removeEventListener('pointermove', move)
      btn.removeEventListener('pointerup', up)
      if (!spawned) return
      torn.current = true
      let s = ent(spawned)
      send(
        { eid: spawned, name: 'card', comp: s.card },
        { eid: spawned, name: 'pin', comp: s.pin },
      )
    }
    btn.addEventListener('pointermove', move)
    btn.addEventListener('pointerup', up)
  }

  return (
    <div
      class='Pin'
      style={`left:${p.x}px;top:${p.y}px;z-index:${p.z};` +
        (p.w ? `width:${p.w}px;` : '')}
      onPointerDown={down}
    >
      <section class='Card'>
        <header class='Card_Tabs'>
          <button
            type='button'
            class='Card_X'
            onClick={() => mutate({ eid: p.eid, name: 'entity', comp: null })}
          >
            ×
          </button>
          {applicable(ent(p.target_eid)).map((v) => (
            <button
              type='button'
              class={v.id == p.view ? 'Tab Tab-on' : 'Tab'}
              onPointerDown={(e) => tear(e, v.id)}
              onClick={() => {
                if (torn.current) {
                  torn.current = false
                  return
                }
                if (v.id != p.view) {
                  mutate({ eid: p.eid, name: 'card', comp: { view: v.id } })
                }
              }}
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
