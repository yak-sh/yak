import { type ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { IS_BROWSER } from 'fresh/runtime'
import { camera, clientId, send, sock } from '../live.ts'

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

  // Comps travel as patches — send only the props that moved.
  let save = (comp: Record<string, number | string>) => {
    if (cam.current) send({ eid: cam.current, name: 'camera', comp })
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
        cam.current = crypto.randomUUID()
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
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save({ w, h }), 400)
    }
    addEventListener('resize', resize)
    return () => {
      s.removeEventListener('message', hear)
      removeEventListener('resize', resize)
    }
  }, [eid])

  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.target instanceof Element && e.target.closest('.Pin')) return
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
      save({ x: camera.value.x, y: camera.value.y })
    }
    elem.addEventListener('pointermove', move)
    elem.addEventListener('pointerup', up)
  }

  // Zoom toward the cursor: the plane point under it stays put.
  let wheel = (e: WheelEvent & { currentTarget: HTMLDivElement }) => {
    e.preventDefault()
    let { x, y, zoom, w, h } = camera.value
    let z = Math.min(4, Math.max(0.25, zoom * Math.exp(-e.deltaY / 800)))
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
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(
      () =>
        save({ x: camera.value.x, y: camera.value.y, zoom: camera.value.zoom }),
      400,
    )
  }

  let { x, y, zoom, w, h } = camera.value
  let tx = w / 2 - x * zoom
  let ty = h / 2 - y * zoom
  return (
    <div
      ref={el}
      class='Canvas'
      style={`background-position:${tx}px ${ty}px;` +
        `background-size:${24 * zoom}px ${24 * zoom}px`}
      onPointerDown={down}
      onWheel={wheel}
    >
      <div
        class='Canvas_Plane'
        style={`transform:translate(${tx}px,${ty}px) scale(${zoom})`}
      >
        {children}
      </div>
    </div>
  )
}
