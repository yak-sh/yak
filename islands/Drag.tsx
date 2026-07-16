import { type ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { IS_BROWSER } from 'fresh/runtime'

// One socket per client, lazily opened; batches queue behind the handshake.
let ws: WebSocket | null = null
let sock = () => {
  if (ws && ws.readyState <= WebSocket.OPEN) return ws
  ws = new WebSocket(`ws://${location.host}/ws`)
  return ws
}
let send = (change: unknown) => {
  let s = sock()
  let msg = JSON.stringify([change])
  if (s.readyState == WebSocket.OPEN) s.send(msg)
  else s.addEventListener('open', () => s.send(msg), { once: true })
}

// The draggable pin around a server-rendered card: geometry lives here, the
// card content stays static HTML. Dropping sends the whole pin component over
// the sync socket; a pin change arriving for this eid moves the card.
export let Drag = ({ eid, canvas, x, y, w, h, children }: {
  eid: string
  canvas: string
  x: number
  y: number
  w: number
  h: number
  children: ComponentChildren
}) => {
  let pos = useSignal({ x, y })

  useEffect(() => {
    if (!IS_BROWSER) return
    let s = sock()
    let hear = (m: MessageEvent) => {
      for (let c of JSON.parse(String(m.data))) {
        if (c.eid == eid && c.name == 'pin' && c.comp) {
          pos.value = { x: c.comp.x, y: c.comp.y }
        }
      }
    }
    s.addEventListener('message', hear)
    return () => s.removeEventListener('message', hear)
  }, [eid])

  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.target instanceof Element && e.target.closest('button, a, input')) {
      return
    }
    let el = e.currentTarget
    let dx = e.clientX - pos.value.x
    let dy = e.clientY - pos.value.y
    el.setPointerCapture(e.pointerId)
    let move = (e: PointerEvent) => {
      pos.value = { x: e.clientX - dx, y: e.clientY - dy }
    }
    let up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      send({
        eid,
        name: 'pin',
        comp: {
          canvas_eid: canvas,
          x: Math.round(pos.value.x),
          y: Math.round(pos.value.y),
          w,
          h,
        },
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
