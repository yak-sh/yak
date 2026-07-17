import { useLayoutEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  camera,
  clientId,
  ent,
  mode,
  mutate,
  myCamera,
  pinned,
  send,
  sock,
  toPlane,
  topZ,
  uuid,
} from '../live.ts'
import { type Change } from '../types.ts'
import { pasted } from '../paste.ts'
import { block } from './ui.tsx'
import { applicable } from './registry.ts'
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
  let mouse = useRef<{ x: number; y: number } | null>(null) // paste lands here
  let cam = useRef('') // this client's camera eid for THIS canvas
  let timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  let dirty = useRef(new Set<string>())
  let gesture = useRef<
    {
      mode: 'scroll' | 'pan'
      t: number
      last: number // |delta| of the previous event
      peak: number // max |delta| this gesture — decay reference
      sign: number // direction of the dominant axis
    } | null
  >(null)
  let glide = useSignal(false) // one smooth transition, for zoom-to-card

  // The latched card: <space> doesn't just frame a card, it follows it —
  // when the pin changes shape (a tab switch, an edit growing the body),
  // the camera re-frames with the same glide. Any manual camera move
  // (pan, pinch, 0) lets go. The debounce keeps a drag-resize from
  // fighting the camera mid-gesture: we glide once the shape settles.
  let latched = useRef<HTMLElement | null>(null)
  let ro = useRef<ResizeObserver | null>(null)
  let settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  let unlatch = () => {
    ro.current?.disconnect()
    latched.current = null
    if (settle.current) clearTimeout(settle.current)
  }

  // Glide the camera to frame a pin, zoomed to fit with a margin.
  let frame = (pin: HTMLElement) => {
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

  let latch = (pin: HTMLElement) => {
    unlatch()
    frame(pin)
    latched.current = pin
    ro.current ??= new ResizeObserver(() => {
      let el = latched.current
      if (!el) return
      if (!el.isConnected) return unlatch() // the card was closed
      if (settle.current) clearTimeout(settle.current)
      settle.current = setTimeout(() => frame(el), 150)
    })
    ro.current.observe(pin)
  }

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

    // Normal-mode hotkeys: 0 resets zoom; <space> over a card glides the
    // camera to frame it and latches on — the camera follows shape changes
    // until a manual move lets go.
    let key = (e: KeyboardEvent) => {
      if (mode.value != 'normal' || e.repeat) return
      if (
        e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      ) return
      if (e.key == '0') {
        unlatch()
        camera.value = { ...camera.value, zoom: 1 }
        queue('zoom')
        return
      }
      if (e.key != ' ') return
      let pin = document.querySelector<HTMLElement>('.Pin:hover')
      if (!pin) return
      e.preventDefault()
      latch(pin)
    }
    addEventListener('keydown', key)

    // Paste lands at the cursor (or the viewport centre): the parser turns
    // eids, T-123 ids, URLs, JSON, or plain text into the right entity and
    // a card spawns on it.
    let paste = (ev: ClipboardEvent) => {
      if (
        ev.target instanceof HTMLElement &&
        ev.target.matches('input, textarea, select, [contenteditable]')
      ) return
      let spec = pasted(ev.clipboardData?.getData('text/plain') ?? '')
      if (!spec) return
      ev.preventDefault()
      let box = el.current!.getBoundingClientRect()
      let { x, y } = mouse.current ??
        { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      spawnAt(spec.changes, spec.target, spec.view, spec.w ?? 320, x, y)
    }
    addEventListener('paste', paste)
    return () => {
      unlatch()
      s.removeEventListener('message', hear)
      removeEventListener('resize', resize)
      removeEventListener('keydown', key)
      removeEventListener('paste', paste)
    }
  }, [eid])

  let down = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.target instanceof Element && e.target.closest('.Pin')) return
    unlatch()
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

  // Can anything between the wheel target and the canvas still consume this
  // delta? Direction-aware: a scroller at its end stops counting, so the
  // gesture chains back into panning. Cards with nothing to scroll pan.
  let consumes = (from: Element, to: Element, dx: number, dy: number) => {
    let vertical = Math.abs(dy) >= Math.abs(dx)
    for (let n: Element | null = from; n && n != to; n = n.parentElement) {
      let s = getComputedStyle(n)
      if (
        vertical && /auto|scroll/.test(s.overflowY) &&
        (dy < 0
          ? n.scrollTop > 0
          : n.scrollTop + n.clientHeight < n.scrollHeight - 1)
      ) return true
      if (
        !vertical && /auto|scroll/.test(s.overflowX) &&
        (dx < 0
          ? n.scrollLeft > 0
          : n.scrollLeft + n.clientWidth < n.scrollWidth - 1)
      ) return true
    }
    return false
  }

  // Scroll pans; pinch (ctrl+wheel, per trackpad convention) zooms toward
  // the cursor — the plane point under it stays put.
  let wheel = (e: WheelEvent & { currentTarget: HTMLDivElement }) => {
    glide.value = false
    let { x, y, zoom, w, h } = camera.value
    if (e.ctrlKey) {
      e.preventDefault()
      unlatch()
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
      // Native scroll keeps the gesture only while something under the
      // cursor can still move that way; otherwise the canvas pans. The
      // decision LATCHES for the gesture's lifetime, so a flick that
      // bottoms out a card doesn't dump its momentum into a pan. A
      // gesture ends at 150ms of silence — or EARLY when a new flick
      // shows through the momentum tail: the direction flips, or the
      // magnitude jumps (>2× the last event) after clear decay (<40% of
      // the gesture's peak). No gesture-phase API in Chromium; this is
      // the observable signature of fingers coming back down.
      let now = performance.now()
      let g = gesture.current
      let mag = Math.max(Math.abs(e.deltaX), Math.abs(e.deltaY))
      let sign = Math.sign(
        Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX,
      )
      let fresh = !g || now - g.t >= 150 ||
        (sign != 0 && g.sign != 0 && sign != g.sign) ||
        (g.last < g.peak * 0.4 && mag > g.last * 2 && mag > 4)
      let mode = fresh
        ? (e.target instanceof Element &&
            consumes(e.target, e.currentTarget, e.deltaX, e.deltaY)
          ? 'scroll' as const
          : 'pan' as const)
        : g!.mode
      gesture.current = {
        mode,
        t: now,
        last: mag,
        peak: fresh ? mag : Math.max(g!.peak, mag),
        sign: sign || (g?.sign ?? 0),
      }
      if (mode == 'scroll') return // scrolling a card's body keeps the latch
      e.preventDefault()
      unlatch()
      camera.value = {
        ...camera.value,
        x: x + e.deltaX / zoom,
        y: y + e.deltaY / zoom,
      }
      queue('x', 'y')
    }
  }

  // Spawn a card+pin at a screen point, minting any comps first. With a
  // grab offset the card lands where its drag ghost was dropped; without
  // one it drops centered-x with the titlebar middle under the point.
  let spawnAt = (
    changes: Change[],
    target: string,
    view: string | undefined,
    w: number,
    sx: number,
    sy: number,
    ox?: number,
    oy?: number,
  ) => {
    if (changes.length) mutate(...changes)
    let at = toPlane(sx, sy, el.current!.getBoundingClientRect())
    let { zoom } = camera.value
    let card = uuid()
    mutate(
      {
        eid: card,
        name: 'card',
        comp: {
          eid: card,
          target_eid: target,
          view: view ?? applicable(ent(target))[0] ?? 'JSON',
        },
      },
      {
        eid: card,
        name: 'pin',
        comp: {
          eid: card,
          canvas_eid: eid,
          x: Math.round(at.x - (ox != null ? ox / zoom : w / 2)),
          y: Math.round(at.y - (oy != null ? oy / zoom : 15)),
          w,
          h: 0,
          z: topZ(eid) + 1,
        },
      },
    )
  }

  // A drag dropped on the canvas spawns a new card: our own payloads carry
  // the view + grab offset; anything from outside (desktop files, dragged
  // links or text) runs the same pipeline as pasting.
  let drop = async (e: DragEvent & { currentTarget: HTMLDivElement }) => {
    let dt = e.dataTransfer
    if (!dt) return
    e.preventDefault()
    let sx = e.clientX
    let sy = e.clientY
    let data = dt.getData('application/x-tasks-card')
    if (data) {
      let { target_eid, view, w, ox, oy } = JSON.parse(data)
      spawnAt([], target_eid, view, w, sx, sy, ox, oy)
      return
    }
    let texts: string[] = []
    for (let f of dt.files) {
      if (f.type.startsWith('text/') || !f.type) texts.push(await f.text())
    }
    if (!texts.length) {
      let uri = dt.getData('text/uri-list').split('\n')
        .find((l) => l && !l.startsWith('#'))
      let t = uri ?? dt.getData('text/plain')
      if (t) texts.push(t)
    }
    for (let [i, t] of texts.entries()) {
      let spec = pasted(t)
      if (spec) {
        spawnAt(
          spec.changes,
          spec.target,
          spec.view,
          spec.w ?? 320,
          sx + i * 24,
          sy + i * 24,
        )
      }
    }
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
      onPointerMove={(e: PointerEvent) => {
        mouse.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerLeave={() => {
        mouse.current = null
      }}
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
