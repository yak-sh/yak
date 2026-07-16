import { type ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { IS_BROWSER } from 'fresh/runtime'
import { camera, clientId, send, sock, uuid } from '../live.ts'

// The pannable, zoomable plane of pinned cards. The camera is a per-client,
// per-canvas entity in the db (canvases nest — a client has one camera per
// canvas it looks at), restored on load and patched over the sync socket as
// pans, zooms, and resizes settle. x/y is the viewport center in plane
// coords: translate = viewport/2 - center * zoom.
export let Canvas = ({ eid, children }: {
  eid: string
  children: ComponentChildren
}) => {
  let el = useRef<HTMLDivElement>(null)
  let cam = useRef('') // this client's camera eid for THIS canvas
  let timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  let dirty = useRef(new Set<string>())
  let glide = useSignal(false) // one smooth transition, for zoom-to-card

  // Comps travel as patches — send only the props that moved.
  let save = (comp: Record<string, number | string>) => {
    if (cam.current) send({ eid: cam.current, name: 'camera', comp })
  }

  // Debounced save that remembers WHICH props moved across a burst, so an
  // interleaved pan + zoom doesn't drop the zoom from the final patch.
  let queue = (...props: (keyof typeof camera.value)[]) => {
    for (let p of props) dirty.current.add(p)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      save(Object.fromEntries(
        [...dirty.current].map((p) => [p, camera.value[p as 'x']]),
      ))
      dirty.current.clear()
    }, 400)
  }

  useEffect(() => {
    if (!IS_BROWSER || !el.current) return
    let id = clientId()
    let size = () => ({
      w: el.current!.clientWidth,
      h: el.current!.clientHeight,
    })
    let { w, h } = size()
    camera.value = { ...camera.value, w, h }

    fetch(`/camera/${id}/${eid}`).then((r) => r.json()).then((c) => {
      if (c) {
        cam.current = c.eid
        camera.value = { x: c.x, y: c.y, zoom: c.zoom, w, h }
        if (c.w != w || c.h != h) save({ w, h })
      } else {
        // First look at this canvas: mint the client (whole comp) and a
        // camera centered so the plane origin sits at the viewport corner.
        cam.current = uuid()
        camera.value = { x: w / 2, y: h / 2, zoom: 1, w, h }
        send(
          {
            eid: id,
            name: 'client',
            comp: { user_agent: navigator.userAgent },
          },
          {
            eid: cam.current,
            name: 'camera',
            comp: { client_eid: id, canvas_eid: eid, ...camera.value },
          },
        )
      }
    })

    // Another tab moving this camera moves ours too.
    let s = sock()
    let hear = (m: MessageEvent) => {
      for (let c of JSON.parse(String(m.data))) {
        if (c.eid == cam.current && c.name == 'camera' && c.comp) {
          let { x, y, zoom, w, h } = { ...camera.value, ...c.comp }
          camera.value = { x, y, zoom, w, h }
        }
      }
    }
    s.addEventListener('message', hear)

    let resize = () => {
      let { w, h } = size()
      camera.value = { ...camera.value, w, h }
      queue('w', 'h')
    }
    addEventListener('resize', resize)

    // <space> over a card glides the camera to frame it.
    let key = (e: KeyboardEvent) => {
      if (e.key != ' ' || e.repeat) return
      if (
        e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      ) return
      let pin = document.querySelector<HTMLElement>('.Pin:hover')
      if (!pin) return
      e.preventDefault()
      let { w, h } = camera.value
      let z = Math.min(
        4,
        Math.max(0.25, Math.min(w / pin.offsetWidth, h / pin.offsetHeight)) *
          0.9,
      )
      glide.value = true
      camera.value = {
        x: pin.offsetLeft + pin.offsetWidth / 2,
        y: pin.offsetTop + pin.offsetHeight / 2,
        zoom: z,
        w,
        h,
      }
      queue('x', 'y', 'zoom')
    }
    addEventListener('keydown', key)
    return () => {
      s.removeEventListener('message', hear)
      removeEventListener('resize', resize)
      removeEventListener('keydown', key)
    }
  }, [eid])

  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.target instanceof Element && e.target.closest('.Pin')) return
    glide.value = false
    let elem = e.currentTarget
    let from = camera.value
    let sx = e.clientX
    let sy = e.clientY
    elem.setPointerCapture(e.pointerId)
    let move = (e: PointerEvent) => {
      camera.value = {
        ...from,
        x: from.x - (e.clientX - sx) / from.zoom,
        y: from.y - (e.clientY - sy) / from.zoom,
      }
    }
    let up = () => {
      elem.removeEventListener('pointermove', move)
      elem.removeEventListener('pointerup', up)
      queue('x', 'y')
    }
    elem.addEventListener('pointermove', move)
    elem.addEventListener('pointerup', up)
  }

  // Scroll pans; pinch (ctrl+wheel, per trackpad convention) zooms toward
  // the cursor — the plane point under it stays put.
  let wheel = (e: WheelEvent & { currentTarget: HTMLDivElement }) => {
    glide.value = false
    let { x, y, zoom, w, h } = camera.value
    if (e.ctrlKey) {
      e.preventDefault()
      let z = Math.min(4, Math.max(0.25, zoom * Math.exp(-e.deltaY / 40)))
      let r = e.currentTarget.getBoundingClientRect()
      let cx = e.clientX - r.left - w / 2
      let cy = e.clientY - r.top - h / 2
      camera.value = {
        x: x + cx * (1 / zoom - 1 / z),
        y: y + cy * (1 / zoom - 1 / z),
        zoom: z,
        w,
        h,
      }
      queue('x', 'y', 'zoom')
    } else {
      // Over a card, native scroll owns the gesture (card content scrolls).
      if (e.target instanceof Element && e.target.closest('.Pin')) return
      e.preventDefault()
      camera.value = {
        ...camera.value,
        x: x + e.deltaX / zoom,
        y: y + e.deltaY / zoom,
      }
      queue('x', 'y')
    }
  }

  let { x, y, zoom, w, h } = camera.value
  let tx = w / 2 - x * zoom
  let ty = h / 2 - y * zoom
  return (
    <div
      ref={el}
      class={glide.value ? 'Canvas Canvas-glide' : 'Canvas'}
      style={`background-position:${tx}px ${ty}px;` +
        `background-size:${24 * zoom}px ${24 * zoom}px`}
      onPointerDown={down}
      onWheel={wheel}
    >
      <div
        class={glide.value ? 'Canvas_Plane Canvas_Plane-glide' : 'Canvas_Plane'}
        style={`transform:translate(${tx}px,${ty}px) scale(${zoom})`}
      >
        {children}
      </div>
    </div>
  )
}
