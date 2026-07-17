import { idOf } from '../types.ts'
import { ent } from '../live.ts'
import { define, has, resolve } from './registry.ts'
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
import { TaskRow } from './views/TaskRow.tsx'
import { Id } from './views/Id.tsx'
import { Dependency } from './views/Dependency.tsx'
import { Debug, DebugAnyItem, DebugTaskItem } from './views/Debug.tsx'
import { Json } from './views/Json.tsx'
import { Md, mdText } from './views/Md.tsx'
import { Web } from './views/Web.tsx'

// Convenience re-exports: View.tsx is the front door, registry.ts the
// engine room — importers of either get the same bindings.
export { applicable, extend, has, type Renderer, resolve } from './registry.ts'

// The CURATED registry — every view the app can render, one list, in
// priority order (a score tie goes to the earlier entry). The machinery
// lives in registry.ts, so this file is exactly: the list, the View
// component, and the drag payload. Adding a view = a file under views/,
// an entry here, and — if it should appear as a card tab — a name in the
// tabs list plus an icon in Card.tsx.
define([
  { view: 'Task', match: has('doc', 'task'), Render: Task, Card: TaskCard },
  { view: 'Board', match: has('doc', 'board'), Render: Board },
  { view: 'Task.Row', match: has('doc', 'task'), Render: TaskRow },
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
], ['Task', 'Board', 'Doc', 'Web', 'Markdown', 'JSON', 'Debug'])

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
