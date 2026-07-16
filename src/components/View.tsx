import { type JSX } from 'preact'
import { type Ent } from '../types.ts'
import { ent } from '../live.ts'
import { Task } from './views/Task.tsx'
import { Board } from './views/Board.tsx'
import { Id } from './views/Id.tsx'
import { Dependency } from './views/Dependency.tsx'
import { DebugAny, DebugTask } from './views/Debug.tsx'
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
  { view: 'Debug', match: (e) => !!e.task, Render: DebugTask },
  { view: 'Debug', match: () => true, Render: DebugAny },
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
// through a view. Extra props flow through to the renderer (Debug's depth).
export let View = (
  { eid, view, ...rest }: { eid: string; view?: string; [x: string]: unknown },
) => {
  let e = ent(eid)
  let r = resolve(e, view)
  return <r.Render e={e} {...rest} />
}
