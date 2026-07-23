import { useRef, useState } from 'preact/hooks'
import { md } from '../../md.ts'
import { comps, type Ent } from '../../types.ts'
import {
  backlinks,
  boardsOver,
  commentCount,
  ent,
  gated,
  parents,
  settled,
  statuses,
} from '../../live.ts'
import { linkProps } from '../nav.tsx'
import { block, Stamp } from '../ui.tsx'
import { Comments } from '../Comments.tsx'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { Edit } from '../Edit.tsx'
import { editorFor, Prop } from '../editors.tsx'
import { Relate } from './Relate.tsx'
import { Id } from './Inline.tsx'
import { View } from '../View.tsx'

// The lego box. A SECTION is an internal view ('Body', 'Meta',
// 'Dependencies', 'Runs', 'Comments' — registered in View.tsx like 'Id'
// and 'Dependency'): matched per entity through the registry door, and
// each renders NOTHING when its data is absent. Show serves the Full
// role — the one generic whole-entity view, just stacking the sections —
// so there is no Task-vs-Doc split to keep in sync: a bare doc simply
// has fewer sections with something to say. Specializing a section for
// an entity shape is a higher-scoring registry entry, not an edit here.

let Frame = block('div', 'Show', {
  Heading: 'h1',
  Title: 'span',
  Body: 'p',
  Claim: 'a',
  Domain: 'span',
  Project: 'a',
  Assignee: 'a',
  Meta: 'div',
  Comments: 'span',
  Runs: 'div',
  Boards: 'div',
  Tasks: 'div',
})
let {
  Heading,
  Title,
  Body: BodyEl,
  Claim,
  Domain,
  Project,
  Assignee,
  Meta: MetaEl,
  Comments: Talk,
  Runs: RunsEl,
  Boards: BoardsEl,
  Tasks: TasksEl,
} = Frame

// The status pip IS the status control: a click anchors the vocabulary's
// enum editor on the dot — every status one press away, and a slip is a
// closed menu, not a written status (the old cycle wrote on every click).
// The registry supplies the picker exactly as Prop would — its popout
// wrapper owns the anchor dance; only the face differs — a bare Dot
// (kept out of the editor's hands), so the heading and titlebar flex
// rows keep their dot untouched by Prop's value chrome.
export let Pip = ({ e }: { e: Ent }) => {
  let [open, setOpen] = useState(false)
  let anchor = useRef<HTMLElement>(null)
  let t = comps.task.status
  let ed = editorFor(t)!
  return (
    <>
      <Dot
        elRef={anchor}
        status={e.task!.status}
        gated={gated(e)}
        class='Show_Pip'
        onClick={() => setOpen((was) => !was)}
      />
      {open && (
        <ed.Edit
          eid={e.eid}
          comp='task'
          prop='status'
          t={t}
          value={e.task!.status}
          done={() => setOpen(false)}
          anchor={anchor}
          side='below'
        />
      )}
    </>
  )
}

// The task fields, all through the registry door (editors.tsx Prop):
// the faces stay the board grammar's chips — Prio badge, domain chip,
// project link — while the registry supplies each type's editor from the
// vocabulary (number box, domain well, project search). A LINK face
// keeps its own click; the press takes the rest of the value.
let Rank = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='priority'
    editable
    name='priority'
    show={(v) => <Prio p={Number(v ?? 0)} class='Show_Chip' />}
  />
)

let Facet = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='domain'
    editable
    name='domain'
    show={(v) => (v ? <Domain>{String(v)}</Domain> : null)}
  />
)

// Whose plate: the assignee face is a LINK to the person (or the project
// standing in for its operator) — same grammar as Home. Claim (⚑, who's
// on it NOW) renders separately.
let Plate = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='assignee_eid'
    editable
    name='assignee'
    show={(v) => {
      if (!v) return null
      let a = ent(String(v))
      return <Assignee {...linkProps(a)}>{a.doc?.title ?? a.kind}</Assignee>
    }}
  />
)

let Home = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='project_eid'
    editable
    name='project'
    show={(v) => {
      if (!v) return null
      let p = ent(String(v))
      return <Project {...linkProps(p)}>{p.doc?.title ?? p.kind}</Project>
    }}
  />
)

// ---- the sections ----

// The body is markdown: rendered as HTML (md.ts; our own data, so no
// sanitizer between us and ourselves), double-click swaps in the raw
// source through the same <Edit>, and the blur that commits swaps the
// rendered view back. An empty body keeps a line of height to give the
// double-click somewhere to land.
export let Body = ({ e, mod }: { e: Ent; mod?: string }) => {
  let [src, setSrc] = useState(false)
  if (!e.doc) return null
  return src
    ? (
      <BodyEl mod={mod}>
        <Edit
          eid={e.eid}
          comp='doc'
          prop='body'
          multi
          open
          onClose={() => setSrc(false)}
        />
      </BodyEl>
    )
    : (
      <BodyEl
        mod={mod}
        onDblClick={() => setSrc(true)}
        dangerouslySetInnerHTML={{ __html: md(e.doc?.body ?? '') }}
      />
    )
}

// The reversed sentences: how each edge below reads from the child's side.
export let up: Record<string, string> = {
  contains: 'part of',
  requires: 'required by',
  reads: 'read by',
  about: 'subject of',
}

// Every edge sentence an entity speaks, top-down: what holds it (reversed
// — 'part of X', 'required by Y'), then what it holds — its contains
// children (ent() splits those out of refs into kids, so they'd
// otherwise only show as board tallies) and its requires/reads.
export let Dependencies = ({ e }: { e: Ent }) => (
  <>
    {parents(e.eid).map((d) => (
      <View
        key={d.parent + d.type}
        eid={d.parent}
        view='Dependency'
        type={d.type}
        label={up[d.type] ?? d.type}
      />
    ))}
    {e.kids.map((k) => (
      <View key={k.eid} eid={k.eid} view='Dependency' type='contains' />
    ))}
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
  </>
)

// The entity's sessions: every run that named it (backlinks via
// session.requested_task_eid) plus the claim's holder — one row each, so
// a task is the door to the agents that worked it.
export let Runs = ({ e }: { e: Ent }) => {
  let ids = new Set(
    backlinks(e.eid)
      .filter((b) => b.via == 'session.requested_task_eid')
      .map((b) => b.from),
  )
  if (e.claim) ids.add(e.claim.session_eid)
  if (!ids.size) return null
  return (
    <RunsEl>
      {[...ids].map((s) => <View key={s} eid={s} view='List.Tile' />)}
    </RunsEl>
  )
}

// The saved boards that watch this entity — a project's boards, found by
// boardsOver's query scan, since a query string is where a board names
// its subject.
export let Boards = ({ e }: { e: Ent }) => {
  let ids = boardsOver(e.eid)
  if (!ids.length) return null
  return (
    <BoardsEl>
      {ids.map((b) => <View key={b} eid={b} view='List.Tile' />)}
    </BoardsEl>
  )
}

// The tasks homed here — every task whose project_eid names this entity.
// Open work only, board-ordered (status column, then rank): the project
// page is a working view; the full history lives on its boards.
export let Tasks = ({ e }: { e: Ent }) => {
  let ids = backlinks(e.eid)
    .filter((b) => b.via == 'task.project_eid')
    .map((b) => ent(b.from))
    .filter((t) => t.task && !settled(t.task.status))
    .sort((a, b) =>
      statuses.indexOf(a.task!.status) - statuses.indexOf(b.task!.status) ||
      a.task!.priority - b.task!.priority
    )
  if (!ids.length) return null
  return (
    <TasksEl>
      {ids.map((t) => <View key={t.eid} eid={t.eid} view='List.Tile' />)}
    </TasksEl>
  )
}

// The meta line — the board row's grammar, prio · project · domain · 💬
// · ⚑ · age, every field the same editor everywhere. In a card frame the
// titlebar carries title, pip, and id, so an empty line renders nothing;
// the document face (root Full) passes `id` and always gets the row —
// its id chip lives here, under the h1.
export let Meta = ({ e, id }: { e: Ent; id?: boolean }) => {
  let talk = commentCount.value[e.eid]
  if (!id && !e.task && !talk && !e.claim) return null
  return (
    <MetaEl>
      {e.task && (
        <>
          <Rank e={e} />
          <Home e={e} />
          <Plate e={e} />
          <Facet e={e} />
        </>
      )}
      {talk && <Talk>💬 {talk}</Talk>}
      {e.claim && (
        <Claim {...linkProps(ent(e.claim.session_eid))}>
          ⚑ {ent(e.claim.session_eid).session?.id}
        </Claim>
      )}
      <Stamp e={e} />
      {id && <Id e={e} />}
    </MetaEl>
  )
}

// Comments already speaks eid — a thin adapter gives it the section
// signature so it registers like the rest.
export let Talkback = ({ e }: { e: Ent }) => <Comments eid={e.eid} />

// ---- the one generic Full view: stack the sections ----

// The section stack, walked by both faces — change the order here,
// every doc-carrying entity follows.
let stack = ['Dependencies', 'Relate', 'Boards', 'Tasks', 'Runs', 'Comments']

// The root Full face is the DOCUMENT: a real h1 owns the title at the
// column's measure — it wraps, never truncates — with the pip riding its
// first line and the meta chips in a quiet row beneath (id included; the
// App bar's compact title stays hidden until this h1 scrolls away — the
// view-timeline in styles.css).
export let Show = ({ e }: { e: Ent }) => (
  <Frame>
    <Heading>
      {e.task && <Pip e={e} />}
      <Title>
        <Edit eid={e.eid} comp='doc' prop='title' />
      </Title>
    </Heading>
    <View eid={e.eid} view='Meta' id />
    <View eid={e.eid} view='Body' />
    {stack.map((v) => <View key={v} eid={e.eid} view={v} />)}
  </Frame>
)

// The card face (Card.Full): the titlebar is the head — the meta line
// stands in.
export let ShowCard = ({ e }: { e: Ent }) => (
  <>
    <View eid={e.eid} view='Meta' />
    <View eid={e.eid} view='Body' mod='bare' />
    {stack.map((v) => <View key={v} eid={e.eid} view={v} />)}
  </>
)

export { Relate }
