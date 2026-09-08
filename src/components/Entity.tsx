// The curated views and verbs, with the app's quarantine and memo boundary.
// @yaks/render selects them; @yaks/preact mounts the selected component.
import { render } from '@yaks/preact'
import { and, or, parse, present } from '@yaks/query'
import { statusChanges, subChanges } from '../client.ts'
import { ent, mutate, myActor, myMode, reveal, rows, shown } from '../live.ts'
import { type Ent, statusOf } from '../types.ts'
import {
  type Action,
  bundle,
  define,
  defineActions,
  registry,
  resolve,
  vocab,
} from './registry.ts'
import { shelve } from './shelf.ts'
import { memo } from './memo.ts'
import {
  Acceptance,
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
import { Split } from './views/Split.tsx'
import { Layout } from './views/Layout.tsx'
import { Dashboard } from './views/Dashboard.tsx'
import { Persona } from './views/Persona.tsx'
import { Inbox } from './views/Inbox.tsx'
import { Usage } from './views/Usage.tsx'
import { MemoryTile } from './views/Memory.tsx'
import { TaskTile } from './views/TaskTile.tsx'
import { BoardMeta, BoardTile } from './views/BoardTile.tsx'
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
import { Media } from './views/Media.tsx'
import { Session, SessionRow } from './views/Session.tsx'
import {
  CommandFull,
  CommandSummary,
  EntrySummary,
  MessageFull,
  MessageSummary,
  PromptSummary,
  ResultFull,
  ResultSummary,
} from './views/Entry.tsx'
import { Role } from './views/Role.tsx'
import { Wake, WakeTitle } from './views/Wake.tsx'
import { openRun } from './Run.tsx'
import { viaName } from './Comments.tsx'
import { block } from './ui.tsx'
import { favoriteChange, favoriteLabel } from '../navigation.ts'

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
    match: parse('.canvas'),
    Render: ({ e }) => <Canvas eid={e.eid} />,
  },
  { view: 'List', match: parse('.canvas'), Render: List },
  { view: 'List', match: parse('.board'), Render: BoardList },
  { view: 'Tile', match: parse('.doc .memory'), Render: MemoryTile },
  // TaskTile walks back through Entity for its Meta row; defer the binding
  // for the same reason as Canvas above.
  {
    view: 'Tile',
    match: parse('.doc .task'),
    Render: (props) => <TaskTile {...props} />,
  },
  { view: 'Tile', match: parse('.doc .board'), Render: BoardTile },
  { view: 'Tray.List.Tile', match: parse('.session'), Render: SessionRow },
  { view: 'Tile', match: parse('.session'), Render: SessionRow },
  { view: 'Tile', match: and(), Render: ListTile },
  { view: 'Wake', match: parse('.wake'), Render: Wake },
  { view: 'Session', match: parse('.session'), Render: Session },
  { view: 'Full', match: parse('.doc'), Render: Show },
  { view: 'Card.Full', match: parse('.doc'), Render: CardFull },
  { view: 'Board', match: parse('.doc .board'), Render: Board },
  // The two-pane inbox: list left, opened entity right. A view of anything
  // with a list face (a board/project, or a canvas), never a default face —
  // it sits after Board/List in the tabs list so it is a chosen tab.
  {
    view: 'Split',
    match: and(or(present('board'), present('canvas'))),
    Render: Split,
  },
  // The tiling container (D-14718) — a layout's default face. Its leaves
  // walk back through Entity, so defer the binding like Canvas above.
  {
    view: 'Layout',
    match: parse('.doc .layout'),
    Render: (props) => <Layout {...props} />,
  },
  // The Project Cockpit (D-14587). One grouped clause ties with Full's
  // doc clause, so Full keeps the project's default face:
  // the cockpit is a chosen tab, never a changed default. Its facet rows
  // walk back through Entity; defer the binding like Canvas above.
  {
    view: 'Dashboard',
    match: and(parse('.doc .project')),
    Render: (props) => <Dashboard {...props} />,
  },
  { view: 'Persona', match: parse('.doc .persona'), Render: Persona },
  // Usage reads FOR a project: the cost + throughput of the sessions that
  // worked its tasks, projected from usage.ts. Delegates nothing, so no
  // deferral needed.
  {
    view: 'Usage',
    match: parse('.project'),
    Render: (props) => <Usage {...props} />,
  },
  // An inbox reads FOR an actor, so it offers itself on the two things
  // that can be one: a venture and a person.
  // Inbox delegates its rows back through Entity, so defer the binding as
  // with every other composite view above.
  {
    view: 'Inbox',
    match: parse('.project'),
    Render: (props) => <Inbox {...props} />,
  },
  {
    view: 'Inbox',
    match: parse('.person'),
    Render: (props) => <Inbox {...props} />,
  },
  // Role's linked-session sections walk back through Entity, so defer the
  // binding like Canvas's cycle above.
  {
    view: 'Role',
    match: parse('.doc .role'),
    Render: (props) => <Role {...props} />,
  },
  { view: 'Web', match: parse('.web'), Render: Web },
  // Registered AFTER Full: a bare attachment has no doc, so Media is its sole
  // match; a task/comment that wears one keeps its own face while still
  // offering a Media tab. Blob entities are shared content, not attachments.
  { view: 'Media', match: parse('.attachment'), Render: Media },
  // Entry faces use the same specificity rules as every entity view. The
  // generic entry is the floor; facets such as bash and result override it.
  {
    view: 'Summary',
    match: parse('.entry .call .bash'),
    Render: CommandSummary,
  },
  {
    view: 'Summary',
    match: parse('.entry .prompt .message'),
    Render: PromptSummary,
  },
  { view: 'Summary', match: parse('.entry .result'), Render: ResultSummary },
  { view: 'Summary', match: parse('.entry .message'), Render: MessageSummary },
  { view: 'Summary', match: parse('.entry'), Render: EntrySummary },
  { view: 'Full', match: parse('.entry .call .bash'), Render: CommandFull },
  { view: 'Full', match: parse('.entry .result'), Render: ResultFull },
  { view: 'Full', match: parse('.entry .message'), Render: MessageFull },
  {
    view: 'Entry.Debug',
    match: parse('.entry'),
    Render: ({ e }) => <Debug e={e} tabs={false} />,
  },
  // The sections — Full's legos, internal views like Inline and Dependency.
  // Catch-all matchers on purpose: each renders nothing when its data is
  // absent, and a specialized look for an entity shape is a higher-
  // scoring entry above these, never an edit to Full.
  { view: 'Body', match: and(), Render: Body },
  { view: 'Acceptance', match: and(), Render: Acceptance },
  { view: 'Meta', match: parse('.board'), Render: BoardMeta },
  { view: 'Meta', match: and(), Render: Meta },
  { view: 'Mail', match: and(), Render: Mail },
  {
    view: 'Dependencies',
    match: parse('.comment'),
    Render: CommentDependencies,
  },
  { view: 'Dependencies', match: and(), Render: Dependencies },
  { view: 'Relate', match: and(), Render: Relate },
  { view: 'Boards', match: and(), Render: Boards },
  { view: 'Tasks', match: and(), Render: Tasks },
  { view: 'Runs', match: and(), Render: Runs },
  { view: 'Similar', match: and(), Render: Similar },
  { view: 'Comments', match: and(), Render: Talkback },
  { view: 'Card.Title', match: parse('.wake .deliver'), Render: WakeTitle },
  { view: 'Card.Title', match: parse('.doc .task'), Render: TaskTitle },
  { view: 'Card.Title', match: parse('.doc .board'), Render: BoardTitle },
  { view: 'Card.Title', match: parse('.doc .role'), Render: RoleTitle },
  { view: 'Card.Title', match: parse('.web'), Render: WebTitle },
  { view: 'Card.Title', match: parse('.session'), Render: SessionTitle },
  { view: 'Card.Title', match: parse('.doc'), Render: DocTitle },
  { view: 'Card.Title', match: and(), Render: AnyTitle },
  {
    view: 'Markdown',
    match: parse('.doc'),
    Render: Md,
    file: { ext: 'md', mime: 'text/markdown', text: mdText },
  },
  {
    view: 'JSON',
    match: and(),
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
    match: parse('.alias.slug=vocabulary'),
    Render: Schema,
  },
  { view: 'Debug', match: parse('.project'), Render: ProjectDebug },
  { view: 'Debug', match: and(), Render: Debug },
  { view: 'Debug.Tile', match: parse('.task'), Render: DebugTaskItem },
  { view: 'Debug.Tile', match: and(), Render: DebugAnyItem },
  { view: 'Inline', match: parse('.doc .task'), Render: TaskInline },
  { view: 'Inline', match: and(), Render: Inline },
  { view: 'Dependency', match: and(), Render: Dependency },
], [
  'Wake',
  'Canvas',
  'Board',
  'List',
  'Split',
  'Layout',
  'Persona',
  // After Inbox on purpose: the fullscreen bar opens a bare URL on
  // tabs[0] (App.tsx), and a project's first tab was Inbox before the
  // cockpit existed — the cockpit is a chosen tab, never a changed
  // default.
  'Inbox',
  'Dashboard',
  'Usage',
  'Role',
  'Session',
  'Full',
  'Web',
  'Media',
  'Schema',
  'Debug',
])

// The context-menu verbs, contributed per component (union — see
// registry.ts). A task offers its status moves and a session to run on
// it, a live claim offers release, and anything at all can be deleted
// (the red row at the end).
// The decision verbs a proposed, undecided thing offers: approve or decline,
// writing `decided {verdict}`. `by` is the server's to derive from the
// client's actor — a human clicking IS the person. Approving an OPEN task
// arms dispatch (the sweep may spawn a coder within seconds), so its label
// says so. Shared by the entity menu and the proposal icon (Show.tsx).
export let decisionActions = (e: Ent): Action[] => {
  if (!e.proposed || e.decided || statusOf(e) == 'cancelled') return []
  let decide = (verdict: string) => () =>
    mutate({ eid: e.eid, name: 'decided', comp: { verdict } })
  let dispatches = !!e.task && statusOf(e) == 'open'
  return [
    {
      label: dispatches ? 'approve · dispatches a coder' : 'approve',
      run: decide('approved'),
    },
    { label: 'decline', run: decide('declined') },
  ]
}

defineActions([
  {
    // The Shelf is universal screen chrome: any entity may become the
    // bottom-right popover, not only the chats that choose it by default.
    match: and(),
    acts: (e) => [{
      label: 'open in tray',
      run: () => shelve(e.eid, resolve(e).view),
    }],
  },
  {
    match: and(),
    acts: (e) => [{
      label: favoriteLabel(e),
      run: () => mutate(favoriteChange(e)),
    }],
  },
  {
    match: parse('.proposed'),
    acts: decisionActions,
  },
  {
    match: parse('.task'),
    acts: (e) => {
      let s = statusOf(e)
      // Status is DERIVED (D-24102): a move mints/retracts the mark
      // (statusChanges), never a status column. wip is a live claim, so on the
      // web (no session) 'start' falls back to reopening — the task reads open
      // until it is claimed.
      let move = (label: string, status: string): Action => ({
        label,
        run: () => mutate(...statusChanges(e.eid, status)),
      })
      // Cancelling wants a why: after the write, the cursor lands in the
      // entity's comment box — a nudge toward the convention, never a
      // gate (guarded: the TUI has no document).
      let cancel: Action = {
        label: 'cancel',
        run: () => {
          mutate(...statusChanges(e.eid, 'cancelled'))
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
    // The external-block facet (D-17094): unblock is trivial everywhere;
    // block needs a free-text reason, so it's offered only where a prompt
    // exists (the browser) — the TUI blocks via `task block`. This is what
    // reddens the Dot, orthogonal to the status moves above.
    match: parse('.task'),
    acts: (e) =>
      e.blocked
        ? [{
          label: 'unblock',
          run: () => mutate({ eid: e.eid, name: 'blocked', comp: null }),
        }]
        : typeof globalThis.prompt == 'function'
        ? [{
          label: 'block…',
          run: () => {
            let on = globalThis.prompt('Blocked on? (external reason)')?.trim()
            if (on) mutate({ eid: e.eid, name: 'blocked', comp: { on } })
          },
        }]
        : [],
  },
  {
    match: parse('.role'),
    acts: (e) => [{
      label: e.role!.state == 'running' ? 'pause role' : 'resume role',
      // Start also fences the crash-loop breaker (retry_at). Reconciliation
      // clears the shared error only after the role starts successfully.
      run: () =>
        mutate({
          eid: e.eid,
          name: 'role',
          comp: e.role!.state == 'running' ? { state: 'paused' } : {
            state: 'running',
            retry_at: new Date().toISOString(),
          },
        }),
    }, {
      label: 'stop role',
      run: () =>
        mutate({ eid: e.eid, name: 'role', comp: { state: 'stopped' } }),
    }],
  },
  {
    // Watch and mute, on ANYTHING — a standing instruction is about a
    // thread, and a thread can be a task, a venture, a session. Offered
    // only to a viewer whose client names an actor: without one there is
    // nobody for the instruction to belong to.
    match: and(),
    acts: (e) => {
      if (!myActor()) return []
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
    match: parse('.claim'),
    acts: (e) => [{
      label: `release ${viaName(e.claim!.session)}`,
      run: () => mutate({ eid: e.eid, name: 'claim', comp: null }),
    }],
  },
  {
    // Retiring stamps the moment; unretiring clears it. Everything filed
    // under the project stays — it just stops coming up first.
    match: parse('.project'),
    acts: (e) => [
      e.archived
        ? {
          label: 'unretire',
          run: () => mutate({ eid: e.eid, name: 'archived', comp: null }),
        }
        : {
          label: 'retire',
          run: () =>
            mutate({
              eid: e.eid,
              name: 'archived',
              comp: {},
            }),
        },
    ],
  },
  {
    match: and(),
    acts: (e) => [
      e.quarantined
        ? {
          label: 'unquarantine',
          run: () => mutate({ eid: e.eid, name: 'quarantined', comp: null }),
        }
        : {
          label: 'quarantine',
          run: () => mutate({ eid: e.eid, name: 'quarantined', comp: {} }),
        },
    ],
  },
  {
    match: and(),
    acts: (e) => [{
      label: 'delete',
      mod: 'danger',
      run: () => mutate({ eid: e.eid, name: 'entity', comp: null }),
    }],
  },
])

// The one front door: render an entity (straight out of the live cache)
// through a view. Extra props flow through to the renderer.
let Veil = block('section', 'Quarantine', { Reveal: 'button' })
let EntityFace = (
  { eid, view, ...rest }: {
    eid: string
    view?: string
    [x: string]: unknown
  },
) => {
  let e = ent(eid)
  if (!shown(eid)) {
    return (
      <Veil>
        Quarantined content
        <Veil.Reveal type='button' onClick={() => reveal(eid)}>
          Reveal
        </Veil.Reveal>
      </Veil>
    )
  }
  return render(registry, bundle(e), view, vocab, rest, { e, ...rest })
}

export let Entity = memo(EntityFace)
