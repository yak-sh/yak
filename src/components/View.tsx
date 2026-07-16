import { type JSX } from 'preact'
import { type Ent } from '../types.ts'
import { ent } from '../live.ts'
import { idOf } from './views/Id.tsx'
import { Task } from './views/Task.tsx'
import { Board } from './views/Board.tsx'
import { Id } from './views/Id.tsx'
import { Dependency } from './views/Dependency.tsx'
import { Debug, DebugAnyItem, DebugTaskItem } from './views/Debug.tsx'
import { Json } from './views/Json.tsx'
import { Md, mdText } from './views/Md.tsx'

// The vocabulary: a VIEW is a string — a named way of looking at an entity
// ('Task', 'Debug', 'Id', …). It's what a card stores and what a tab picks.
// A RENDERER is a component registered for one view + an entity predicate;
// several renderers can serve the same view (Debug-for-tasks above the
// generic Debug catch-all — first match wins, so specific goes first).
// A renderer may also carry a FILE form: how this view of this entity
// serializes when its tab is dragged to the desktop.
type Renderer = {
  view: string
  match: (e: Ent) => boolean
  Render: (p: { e: Ent; [x: string]: unknown }) => JSX.Element
  file?: { ext: string; mime: string; text: (e: Ent) => string }
}

// Fixed and curated — extended only by editing this file, never at runtime.
let registry: Renderer[] = [
  { view: 'Task', match: (e) => !!e.task, Render: Task },
  { view: 'Board', match: (e) => !!e.project, Render: Board },
  {
    view: 'MD',
    match: (e) => !!e.task,
    Render: Md,
    file: { ext: 'md', mime: 'text/markdown', text: mdText },
  },
  {
    view: 'JSON',
    match: () => true,
    Render: Json,
    file: {
      ext: 'json',
      mime: 'application/json',
      text: (e) => JSON.stringify(e, null, 2),
    },
  },
  { view: 'Debug', match: () => true, Render: Debug },
  { view: 'Debug.ListItem', match: (e) => !!e.task, Render: DebugTaskItem },
  { view: 'Debug.ListItem', match: () => true, Render: DebugAnyItem },
  { view: 'Id', match: () => true, Render: Id },
  { view: 'Dependency', match: () => true, Render: Dependency },
]

// The views that may appear as card tabs, in tab order. A view tabs for an
// entity iff some renderer serves it; Debug's catch-all means every card
// gets a Debug tab. Views not listed here (Id, Dependency) are internal —
// reachable only by explicit name.
let tabs = ['Task', 'Board', 'MD', 'JSON', 'Debug']

export let applicable = (e: Ent) =>
  tabs.filter((v) => registry.some((r) => r.view == v && r.match(e)))

// The renderer serving a view of an entity; no view asks for the first
// applicable tab. An unservable ask falls back to the JSON catch-all.
export let resolve = (e: Ent, view?: string) =>
  (view
    ? registry.find((r) => r.view == view && r.match(e))
    : registry.find((r) => tabs.includes(r.view) && r.match(e))) ??
    registry.find((r) => r.view == 'JSON')!

// The one front door: render an entity (straight out of the live cache)
// through a view. Extra props flow through to the renderer.
export let View = (
  { eid, view, ...rest }: { eid: string; view?: string; [x: string]: unknown },
) => {
  let e = ent(eid)
  let r = resolve(e, view)
  return <r.Render e={e} {...rest} />
}

let b64 = (t: string) =>
  btoa(
    Array.from(new TextEncoder().encode(t), (b) => String.fromCharCode(b))
      .join(''),
  )

// Arm a dragstart with the standard payload: the spawn card (for a canvas
// drop — target + view + width, plus where in the dragged element the grab
// happened, so the spawned card lands where the ghost was dropped), and,
// when the view's renderer has a file form, the serialized file (for a
// desktop drop) plus text for editors.
export let dragData = (ev: DragEvent, eid: string, view: string, w = 320) => {
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
