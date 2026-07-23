// The drag payload, view-free. This lives OUTSIDE Entity.tsx so nav.tsx
// (which every view imports for linkProps) never pulls the curated view
// list into a cycle: views/Inline.tsx → nav.tsx → Entity.tsx → views/Inline.tsx
// was a TDZ time bomb — whichever module entered the cycle first left
// Entity.tsx's top-level define() list reading an uninitialized view
// binding under hot-swap re-evaluation. dragData needs only the cache
// and the registry, so it belongs with the machinery, not the views.
import { idOf } from '../types.ts'
import { ent } from '../live.ts'
import { resolve } from './registry.ts'

let b64 = (t: string) =>
  btoa(
    Array.from(new TextEncoder().encode(t), (b) => String.fromCharCode(b))
      .join(''),
  )

// Arm a dragstart with the standard payload: the spawn card (for a canvas
// drop — target + view + width, plus where in the dragged element the grab
// happened, so the spawned card lands where the ghost was dropped), and,
// when the view's renderer has a file form, the serialized file (for a
// desktop drop) plus text for editors. `pin` rides only for an EXISTING
// card being relocated (a Tray row dragged out): its presence says MOVE
// this pin, not clone a new card — tab drags omit it, so they still clone.
export let dragData = (
  ev: DragEvent,
  eid: string,
  view: string,
  w = 0,
  pin?: string,
) => {
  if (!ev.dataTransfer || !(ev.currentTarget instanceof HTMLElement)) return
  let e = ent(eid)
  let box = ev.currentTarget.getBoundingClientRect()
  ev.dataTransfer.setData(
    'application/x-tasks-card',
    JSON.stringify({
      target_eid: eid,
      view,
      w,
      ox: ev.clientX - box.left,
      oy: ev.clientY - box.top,
      ...(pin ? { pin } : {}),
    }),
  )
  let f = resolve(e, view).file
  if (!f) return
  let text = f.text(e)
  ev.dataTransfer.setData('text/plain', text)
  ev.dataTransfer.setData(
    'DownloadURL',
    `${f.mime}:${idOf(e)}.${f.ext}:data:${f.mime};base64,${b64(text)}`,
  )
}
