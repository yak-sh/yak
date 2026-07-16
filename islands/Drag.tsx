import { type ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { IS_BROWSER } from 'fresh/runtime'
import { camera, send, sock } from '../live.ts'

// The draggable pin around a server-rendered card: geometry lives here, the
// card content stays static HTML. Dropping sends the whole pin component over
// the sync socket; a pin change arriving for this eid moves the card.
export let Drag = ({ eid, x, y, w, children }: {
  eid: string
  x: number
  y: number
  w: number
  children: ComponentChildren
}) => {
  let pos = useSignal({ x, y })

  useEffect(() => {
    if (!IS_BROWSER) return
    let s = sock()
    let hear = (m: MessageEvent) => {
      for (let c of JSON.parse(String(m.data))) {
        if (c.eid == eid && c.name == 'pin' && c.comp) {
          let { x, y } = { ...pos.value, ...c.comp }
          pos.value = { x, y }
        }
      }
    }
    s.addEventListener('message', hear)
    return () => s.removeEventListener('message', hear)
  }, [eid])

  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    // Only the titlebar drags — and its buttons still click, not drag.
    if (!(e.target instanceof Element)) return
    if (e.target.closest('button, a, input')) return
    if (!e.target.closest('.Card_Tabs')) return
    let el = e.currentTarget
    let from = pos.value
    let sx = e.clientX
    let sy = e.clientY
    el.setPointerCapture(e.pointerId)
    let move = (e: PointerEvent) => {
      // Pointer deltas are screen px; the pin lives in plane px.
      let z = camera.value.zoom
      pos.value = {
        x: from.x + (e.clientX - sx) / z,
        y: from.y + (e.clientY - sy) / z,
      }
    }
    let up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      // A drag only moves the pin — patch just x and y.
      send({
        eid,
        name: 'pin',
        comp: { x: Math.round(pos.value.x), y: Math.round(pos.value.y) },
      })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div
      class='Pin'
      style={`left:${pos.value.x}px;top:${pos.value.y}px;` +
        (w ? `width:${w}px;` : '')}
      onPointerDown={down}
    >
      {children}
    </div>
  )
}
