import { useLayoutEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  camera,
  clientId,
  mutate,
  myCamera,
  pinned,
  send,
  sock,
  toPlane,
  topZ,
  uuid,
} from '../live.ts'
import { block } from './ui.tsx'
import { Card } from './Card.tsx'

let Frame = block('div', 'Canvas', { Plane: 'div' })
let { Plane } = Frame

// The pannable, zoomable plane of pinned cards. The camera is a per-client,
// per-canvas entity (canvases nest — a client has one camera per canvas it
// looks at), restored from the cache on mount and patched over the sync
// socket as pans, zooms, and resizes settle. x/y is the viewport center in
// plane coords: translate = viewport/2 - center * zoom.
export let Canvas = ({ eid }: { eid: string }) => {
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

  // Layout effect, not effect: the camera must be measured and restored
  // BEFORE the first paint, or the screen flashes untransformed content.
  useLayoutEffect(() => {
    if (!el.current) return
    let id = clientId()
    let size = () => ({
      w: el.current!.clientWidth,
      h: el.current!.clientHeight,
    })
    let { w, h } = size()

    // The snapshot is already in the cache — restore this client's camera,
    // or mint the client + a camera centered so the plane origin sits at
    // the viewport corner.
    let mine = myCamera(id, eid)
    if (mine) {
      cam.current = mine.eid
      camera.value = { x: mine.x, y: mine.y, zoom: mine.zoom, w, h }
      if (mine.w != w || mine.h != h) save({ w, h })
    } else {
      cam.current = uuid()
      camera.value = { x: w / 2, y: h / 2, zoom: 1, w, h }
      mutate(
        {
          eid: id,
          name: 'client',
          comp: { eid: id, user_agent: navigator.userAgent },
        },
        {
          eid: cam.current,
          name: 'camera',
          comp: {
            eid: cam.current,
            client_eid: id,
            canvas_eid: eid,
            ...camera.value,
          },
        },
      )
    }

    // Another tab moving this camera moves ours too.
    let s = sock()
    let hear = (m: MessageEvent) => {
      let batch = JSON.parse(String(m.data))
      if (!Array.isArray(batch)) return
      for (let c of batch) {
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
      let z = Math.min(4, Math.max(0.25, zoom * Math.exp(-e.deltaY / 80)))
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

  // A tab dropped on the canvas spawns a new card with that view.
  let drop = (e: DragEvent & { currentTarget: HTMLDivElement }) => {
    let data = e.dataTransfer?.getData('application/x-tasks-card')
    if (!data) return
    e.preventDefault()
    let { target_eid, view, w } = JSON.parse(data)
    let at = toPlane(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
    )
    let card = uuid()
    mutate(
      { eid: card, name: 'card', comp: { eid: card, target_eid, view } },
      {
        eid: card,
        name: 'pin',
        comp: {
          eid: card,
          canvas_eid: eid,
          x: Math.round(at.x - 24),
          y: Math.round(at.y - 12),
          w,
          h: 0,
          z: topZ(eid) + 1,
        },
      },
    )
  }

  let { x, y, zoom, w, h } = camera.value
  let tx = w / 2 - x * zoom
  let ty = h / 2 - y * zoom
  return (
    <Frame
      elRef={el}
      mod={glide.value && 'glide'}
      style={`background-position:${tx}px ${ty}px;` +
        `background-size:${24 * zoom}px ${24 * zoom}px`}
      onPointerDown={down}
      onWheel={wheel}
      onDragOver={(e: DragEvent) => e.preventDefault()}
      onDrop={drop}
    >
      <Plane
        mod={glide.value && 'glide'}
        style={`transform:translate(${tx}px,${ty}px) scale(${zoom})`}
      >
        {pinned(eid).map((p) => <Card key={p.eid} p={p} />)}
      </Plane>
    </Frame>
  )
}
