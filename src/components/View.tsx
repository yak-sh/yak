import { idOf } from '../types.ts'
import { ent, mutate } from '../live.ts'
import { type Action, define, defineActions, has, resolve } from './registry.ts'
import {
  Boards,
  Body,
  Dependencies,
  Meta,
  Relate,
  Runs,
  Show,
  ShowCard,
  Talkback,
  Tasks,
} from './views/Show.tsx'
import {
  AnyTitle,
  BoardTitle,
  DocTitle,
  SessionTitle,
  TaskTitle,
  WebTitle,
} from './views/Title.tsx'
import { Board } from './views/Board.tsx'
import { Persona } from './views/Persona.tsx'
import { TaskRow } from './views/TaskRow.tsx'
import { BoardList, List, ListItem } from './views/List.tsx'
import { Canvas } from './Canvas.tsx'
import { Id } from './views/Id.tsx'
import { Dependency } from './views/Dependency.tsx'
import { Debug, DebugAnyItem, DebugTaskItem } from './views/Debug.tsx'
import { Schema } from './views/Schema.tsx'
import { Json } from './views/Json.tsx'
import { Md, mdText } from './views/Md.tsx'
import { Web } from './views/Web.tsx'
import { Session, SessionRow } from './views/Session.tsx'
import { openRun } from './Run.tsx'

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
  // Canvas is referenced lazily (a render closure) — Canvas.tsx imports
  // this file back, and the cycle only stays sound if define() never
  // reads the binding at module init.
  {
    view: 'Canvas',
    match: has('canvas'),
    Render: ({ e }) => <Canvas eid={e.eid} />,
  },
  { view: 'List', match: has('canvas'), Render: List },
  { view: 'List', match: has('board'), Render: BoardList },
  { view: 'List.Item', match: has('doc', 'task'), Render: TaskRow },
  { view: 'List.Item', match: has('session'), Render: SessionRow },
  { view: 'List.Item', match: () => true, Render: ListItem },
  { view: 'Show', match: has('doc'), Render: Show, Card: ShowCard },
  { view: 'Board', match: has('doc', 'board'), Render: Board },
  { view: 'Persona', match: has('doc', 'persona'), Render: Persona },
  { view: 'Task.Row', match: has('doc', 'task'), Render: TaskRow },
  { view: 'Web', match: has('web'), Render: Web },
  { view: 'Session', match: has('session'), Render: Session },
  // The sections — Show's legos, internal views like Id and Dependency.
  // Catch-all matchers on purpose: each renders nothing when its data is
  // absent, and a specialized look for an entity shape is a higher-
  // scoring entry above these, never an edit to Show.
  { view: 'Body', match: () => true, Render: Body },
  { view: 'Meta', match: () => true, Render: Meta },
  { view: 'Dependencies', match: () => true, Render: Dependencies },
  { view: 'Relate', match: () => true, Render: Relate },
  { view: 'Boards', match: () => true, Render: Boards },
  { view: 'Tasks', match: () => true, Render: Tasks },
  { view: 'Runs', match: () => true, Render: Runs },
  { view: 'Comments', match: () => true, Render: Talkback },
  { view: 'Card.Title', match: has('doc', 'task'), Render: TaskTitle },
  { view: 'Card.Title', match: has('doc', 'board'), Render: BoardTitle },
  { view: 'Card.Title', match: has('web'), Render: WebTitle },
  { view: 'Card.Title', match: has('session'), Render: SessionTitle },
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
  // The live schema — its tab appears only on the boot-written
  // Vocabulary doc (alias `vocabulary`), whose Show face is the same
  // content as generated markdown; any card can still ask for the view
  // by name.
  {
    view: 'Schema',
    match: (e) => e.alias?.slug == 'vocabulary',
    Render: Schema,
  },
  { view: 'Debug', match: () => true, Render: Debug },
  { view: 'Debug.ListItem', match: has('task'), Render: DebugTaskItem },
  { view: 'Debug.ListItem', match: () => true, Render: DebugAnyItem },
  { view: 'Id', match: () => true, Render: Id },
  { view: 'Dependency', match: () => true, Render: Dependency },
], [
  'Canvas',
  'List',
  'Board',
  'Persona',
  'Show',
  'Web',
  'Session',
  'Markdown',
  'JSON',
  'Schema',
  'Debug',
])

// The context-menu verbs, contributed per component (union — see
// registry.ts). A task offers its status moves and a session to run on
// it, a live claim offers release, and anything at all can be deleted
// (the red row at the end).
defineActions([
  {
    match: has('task'),
    acts: (e) => {
      let s = e.task!.status
      let move = (label: string, status: string): Action => ({
        label,
        run: () => mutate({ eid: e.eid, name: 'task', comp: { status } }),
      })
      // Cancelling wants a why: after the write, the cursor lands in the
      // entity's comment box — a nudge toward the convention, never a
      // gate (guarded: the TUI has no document).
      let cancel: Action = {
        label: 'cancel',
        run: () => {
          mutate({ eid: e.eid, name: 'task', comp: { status: 'cancelled' } })
          if (typeof document != 'undefined') {
            setTimeout(() =>
              document.querySelector<HTMLElement>(
                `.Comments_New[data-eid="${e.eid}"]`,
              )?.focus(), 0)
          }
        },
      }
      return [
        ...(s != 'wip' ? [move('start', 'wip')] : []),
        ...(s != 'done' ? [move('done', 'done')] : []),
        ...(s != 'open' ? [move('reopen', 'open')] : []),
        ...(s != 'cancelled' ? [cancel] : []),
        { label: 'run agent…', run: () => openRun(e.eid) },
      ]
    },
  },
  {
    match: has('claim'),
    acts: (e) => [{
      label: `release ${ent(e.claim!.session_eid).session?.id ?? 'claim'}`,
      run: () => mutate({ eid: e.eid, name: 'claim', comp: null }),
    }],
  },
  {
    // Retiring stamps the moment; unretiring clears it. Everything filed
    // under the project stays — it just stops coming up first.
    match: has('project'),
    acts: (e) => [
      e.project!.retired_at
        ? {
          label: 'unretire',
          run: () =>
            mutate({ eid: e.eid, name: 'project', comp: { retired_at: null } }),
        }
        : {
          label: 'retire',
          run: () =>
            mutate({
              eid: e.eid,
              name: 'project',
              comp: { retired_at: new Date().toISOString() },
            }),
        },
    ],
  },
  {
    match: () => true,
    acts: (e) => [{
      label: 'delete',
      mod: 'danger',
      run: () => mutate({ eid: e.eid, name: 'entity', comp: null }),
    }],
  },
])

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
