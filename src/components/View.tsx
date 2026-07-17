import { type JSX } from 'preact'
import { type Ent } from '../types.ts'
import { ent } from '../live.ts'
import { idOf } from './views/Id.tsx'
import { Task, TaskCard } from './views/Task.tsx'
import {
  AnyTitle,
  BoardTitle,
  DocTitle,
  TaskTitle,
  WebTitle,
} from './views/Title.tsx'
import { DocCard, DocView } from './views/Doc.tsx'
import { Board } from './views/Board.tsx'
import { Id } from './views/Id.tsx'
import { Dependency } from './views/Dependency.tsx'
import { Debug, DebugAnyItem, DebugTaskItem } from './views/Debug.tsx'
import { Json } from './views/Json.tsx'
import { Md, mdText } from './views/Md.tsx'
import { Web } from './views/Web.tsx'

// The vocabulary: a VIEW is a string — a named way of looking at an entity
// ('Task', 'Debug', 'Id', …). It's what a card stores and what a tab picks.
// A RENDERER is a component registered for one view + an entity matcher.
// There is no kind — an entity is what its components make it, and the
// most SPECIFIC renderer wins: match returns a score (has('doc','task')
// scores 2, so Task beats the plain Doc renderer's 1 on task entities);
// booleans still work as the weakest tier (true = 0.5, the catch-alls).
// Ties go to registration order. Proper queries come later; this is the
// simple thing that works.
// A renderer may also carry a CARD variant — the same view rendering as a
// card body, where the titlebar (the Card.Title view) already shows the
// head — and a FILE form: how this view of this entity serializes when its
// tab is dragged to the desktop.
type Render = (p: { e: Ent; [x: string]: unknown }) => JSX.Element
export type Renderer = {
  view: string
  match: (e: Ent) => number | boolean
  Render: Render
  Card?: Render
  file?: { ext: string; mime: string; text: (e: Ent) => string }
}

// Score a match: the count of components it claimed, 0.5 for a bare true.
let score = (r: Renderer, e: Ent) => {
  let m = r.match(e)
  return m === true ? 0.5 : Number(m)
}

// The standard matcher: all named components present → their count.
export let has = (...names: (keyof Ent & string)[]) => (e: Ent) =>
  names.every((n) => !!e[n]) ? names.length : 0

// Fixed and curated — extended only by editing this file, never at runtime.
let registry: Renderer[] = [
  { view: 'Task', match: has('doc', 'task'), Render: Task, Card: TaskCard },
  { view: 'Board', match: has('doc', 'board'), Render: Board },
  { view: 'Web', match: has('web'), Render: Web },
  { view: 'Doc', match: has('doc'), Render: DocView, Card: DocCard },
  { view: 'Card.Title', match: has('doc', 'task'), Render: TaskTitle },
  { view: 'Card.Title', match: has('doc', 'board'), Render: BoardTitle },
  { view: 'Card.Title', match: has('web'), Render: WebTitle },
  { view: 'Card.Title', match: has('doc'), Render: DocTitle },
  { view: 'Card.Title', match: () => true, Render: AnyTitle },
  {
    view: 'Markdown',
    match: has('doc'),
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
  { view: 'Debug.ListItem', match: has('task'), Render: DebugTaskItem },
  { view: 'Debug.ListItem', match: () => true, Render: DebugAnyItem },
  { view: 'Id', match: () => true, Render: Id },
  { view: 'Dependency', match: () => true, Render: Dependency },
]

// Platform overlays: another render target (the TUI) prepends its own
// renderers at boot — same views, same contract, consulted before the
// shared registry, so first-match-wins doubles as the override mechanism.
// Still curated: called once from an entry point, never at runtime.
let overrides: Renderer[] = []
export let extend = (rs: Renderer[]) => {
  overrides = [...rs, ...overrides]
}
let all = () => (overrides.length ? [...overrides, ...registry] : registry)

// The views that may appear as card tabs, in tab order. A view tabs for an
// entity iff some renderer serves it; Debug's catch-all means every card
// gets a Debug tab. Views not listed here (Id, Dependency) are internal —
// reachable only by explicit name.
let tabs = ['Task', 'Board', 'Doc', 'Web', 'Markdown', 'JSON', 'Debug']

export let applicable = (e: Ent) =>
  tabs.filter((v) => all().some((r) => r.view == v && score(r, e) > 0))

// The renderer serving a view of an entity: the highest-scoring match in
// the pool (the named view's renderers, or every tab view for the default
// look), earliest registration breaking ties. An unservable ask falls
// back to the JSON catch-all.
let best = (e: Ent, pool: Renderer[]) => {
  let top: Renderer | undefined
  let max = 0
  for (let r of pool) {
    let s = score(r, e)
    if (s > max) {
      max = s
      top = r
    }
  }
  return top
}

export let resolve = (e: Ent, view?: string) =>
  best(
    e,
    all().filter((r) => view ? r.view == view : tabs.includes(r.view)),
  ) ?? registry.find((r) => r.view == 'JSON')!

// The one front door: render an entity (straight out of the live cache)
// through a view. context='Card' prefers the renderer's card variant.
// Extra props flow through to the renderer.
export let View = (
  { eid, view, context, ...rest }: {
    eid: string
    view?: string
    context?: 'Card'
    [x: string]: unknown
  },
) => {
  let e = ent(eid)
  let r = resolve(e, view)
  let R = (context == 'Card' ? r.Card : undefined) ?? r.Render
  return <R e={e} {...rest} />
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
