import { subChanges } from '../client.ts'
import { ent, mutate, myActor, myMode, rows } from '../live.ts'
import { type Action, define, defineActions, has, resolve } from './registry.ts'
import { memo } from './memo.ts'
import {
  Boards,
  Body,
  CardFull,
  CommentDependencies,
  Dependencies,
  Mail,
  Meta,
  Relate,
  Runs,
  Show,
  Similar,
  Talkback,
  Tasks,
} from './views/Show.tsx'
import {
  AnyTitle,
  BoardTitle,
  DocTitle,
  RoleTitle,
  SessionTitle,
  TaskTitle,
  WebTitle,
} from './views/Title.tsx'
import { Board } from './views/Board.tsx'
import { Layout } from './views/Layout.tsx'
import { Dashboard } from './views/Dashboard.tsx'
import { Persona } from './views/Persona.tsx'
import { Inbox } from './views/Inbox.tsx'
import { MemoryTile } from './views/Memory.tsx'
import { TaskTile } from './views/TaskTile.tsx'
import { BoardList, List, ListTile } from './views/List.tsx'
import { Canvas } from './Canvas.tsx'
import { Inline, TaskInline } from './views/Inline.tsx'
import { Dependency } from './views/Dependency.tsx'
import {
  Debug,
  DebugAnyItem,
  DebugTaskItem,
  ProjectDebug,
} from './views/Debug.tsx'
import { Schema } from './views/Schema.tsx'
import { Json } from './views/Json.tsx'
import { Md, mdText } from './views/Md.tsx'
import { Web } from './views/Web.tsx'
import { Session, SessionRow } from './views/Session.tsx'
import { Role } from './views/Role.tsx'
import { openRun } from './Run.tsx'
import { viaName } from './Comments.tsx'

// Convenience re-exports: Entity.tsx is the front door, registry.ts the
// engine room — importers of either get the same bindings.
export { applicable, extend, has, type Renderer, resolve } from './registry.ts'

// The CURATED registry — every view the app can render, one list, in
// priority order (a score tie goes to the earlier entry). The machinery
// lives in registry.ts, so this file is exactly: the list and the Entity
// component (the drag payload lives in drag.ts — views import it, so it
// must never live here where the whole list would ride along). Adding a
// view = a file under views/,
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
  { view: 'List.Tile', match: has('doc', 'memory'), Render: MemoryTile },
  // TaskTile walks back through Entity for its Meta row; defer the binding
  // for the same reason as Canvas above.
  {
    view: 'List.Tile',
    match: has('doc', 'task'),
    Render: (props) => <TaskTile {...props} />,
  },
  { view: 'List.Tile', match: has('session'), Render: SessionRow },
  { view: 'List.Tile', match: () => true, Render: ListTile },
  { view: 'Full', match: has('doc'), Render: Show },
  { view: 'Card.Full', match: has('doc'), Render: CardFull },
  { view: 'Board', match: has('doc', 'board'), Render: Board },
  // The tiling container (D-14718) — a layout's default face. Its leaves
  // walk back through Entity, so defer the binding like Canvas above.
  {
    view: 'Layout',
    match: has('doc', 'layout'),
    Render: (props) => <Layout {...props} />,
  },
  // The Project Cockpit (D-14587). Scores 1 on purpose — not
  // has('doc','project')'s 2 — so Full keeps the project's default face:
  // the cockpit is a chosen tab, never a changed default. Its facet rows
  // walk back through Entity; defer the binding like Canvas above.
  {
    view: 'Dashboard',
    match: (e) => !!(e.doc && e.project) && 1,
    Render: (props) => <Dashboard {...props} />,
  },
  { view: 'Persona', match: has('doc', 'persona'), Render: Persona },
  // An inbox reads FOR an actor, so it offers itself on the two things
  // that can be one: a venture and a person.
  { view: 'Inbox', match: has('project'), Render: Inbox },
  { view: 'Inbox', match: has('person'), Render: Inbox },
  // Role's linked-session sections walk back through Entity, so defer the
  // binding like Canvas's cycle above.
  {
    view: 'Role',
    match: has('doc', 'role'),
    Render: (props) => <Role {...props} />,
  },
  { view: 'Web', match: has('web'), Render: Web },
  { view: 'Session', match: has('session'), Render: Session },
  // The sections — Full's legos, internal views like Inline and Dependency.
  // Catch-all matchers on purpose: each renders nothing when its data is
  // absent, and a specialized look for an entity shape is a higher-
  // scoring entry above these, never an edit to Full.
  { view: 'Body', match: () => true, Render: Body },
  { view: 'Meta', match: () => true, Render: Meta },
  { view: 'Mail', match: () => true, Render: Mail },
  {
    view: 'Dependencies',
    match: has('comment'),
    Render: CommentDependencies,
  },
  { view: 'Dependencies', match: () => true, Render: Dependencies },
  { view: 'Relate', match: () => true, Render: Relate },
  { view: 'Boards', match: () => true, Render: Boards },
  { view: 'Tasks', match: () => true, Render: Tasks },
  { view: 'Runs', match: () => true, Render: Runs },
  { view: 'Similar', match: () => true, Render: Similar },
  { view: 'Comments', match: () => true, Render: Talkback },
  { view: 'Card.Title', match: has('doc', 'task'), Render: TaskTitle },
  { view: 'Card.Title', match: has('doc', 'board'), Render: BoardTitle },
  { view: 'Card.Title', match: has('doc', 'role'), Render: RoleTitle },
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
  { view: 'Debug', match: has('project'), Render: ProjectDebug },
  { view: 'Debug', match: () => true, Render: Debug },
  { view: 'Debug.Tile', match: has('task'), Render: DebugTaskItem },
  { view: 'Debug.Tile', match: () => true, Render: DebugAnyItem },
  { view: 'Inline', match: has('doc', 'task'), Render: TaskInline },
  { view: 'Inline', match: () => true, Render: Inline },
  { view: 'Dependency', match: () => true, Render: Dependency },
], [
  'Canvas',
  'List',
  'Board',
  'Layout',
  'Persona',
  // After Inbox on purpose: the fullscreen bar opens a bare URL on
  // tabs[0] (App.tsx), and a project's first tab was Inbox before the
  // cockpit existed — the cockpit is a chosen tab, never a changed
  // default.
  'Inbox',
  'Dashboard',
  'Role',
  'Full',
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
    match: has('role'),
    acts: (e) => [{
      label: e.role!.state == 'running' ? 'stop role' : 'start role',
      // Start also fences the crash-loop breaker (retry_at) and clears a held
      // reason, matching `task role start` — otherwise reviving a fixed role
      // would re-trip on the stale burst (roles.ts breaker).
      run: () =>
        mutate({
          eid: e.eid,
          name: 'role',
          comp: e.role!.state == 'running' ? { state: 'stopped' } : {
            state: 'running',
            retry_at: new Date().toISOString(),
            error: null,
          },
        }),
    }],
  },
  {
    // Watch and mute, on ANYTHING — a standing instruction is about a
    // thread, and a thread can be a task, a venture, a session. Offered
    // only to a viewer whose client names an actor: without one there is
    // nobody for the instruction to belong to.
    match: () => !!myActor(),
    acts: (e) => {
      let mode = myMode(e.eid)
      let set = (to: 'watch' | 'mute' | null) => () =>
        mutate(...subChanges(rows(), myActor()!, e.eid, to))
      return [
        mode == 'watch'
          ? { label: 'unwatch', run: set(null) }
          : { label: 'watch', run: set('watch') },
        mode == 'mute'
          ? { label: 'unmute', run: set(null) }
          : { label: 'mute', run: set('mute') },
      ]
    },
  },
  {
    match: has('claim'),
    acts: (e) => [{
      label: `release ${viaName(e.claim!.session_eid)}`,
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
// through a view. Extra props flow through to the renderer.
let EntityFace = (
  { eid, view, ...rest }: {
    eid: string
    view?: string
    [x: string]: unknown
  },
) => {
  let e = ent(eid)
  let r = resolve(e, view)
  return <r.Render e={e} {...rest} />
}

export let Entity = memo(EntityFace)
