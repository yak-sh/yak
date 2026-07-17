import { useState } from 'preact/hooks'
import snarkdown from 'snarkdown'
import { type Ent } from '../../types.ts'
import {
  backlinks,
  commentCount,
  ent,
  gated,
  mutate,
  parents,
  statuses,
} from '../../live.ts'
import { linkProps } from '../nav.tsx'
import { block, Stamp } from '../ui.tsx'
import { Comments } from '../Comments.tsx'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { Edit } from '../Edit.tsx'
import { Prop } from '../editors.tsx'
import { Relate } from './Relate.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'Task', {
  Head: 'div',
  Title: 'span',
  Body: 'p',
  Claim: 'span',
  Domain: 'span',
  Project: 'a',
  Meta: 'div',
  Comments: 'span',
  Runs: 'div',
})
let {
  Head,
  Title,
  Body,
  Claim,
  Domain,
  Project,
  Meta,
  Comments: Talk,
  Runs: RunsEl,
} = Frame

// The pip commits through this one write: a single column, patched in
// place, down the normal mutate() path.
let set = (e: Ent, prop: string, v: unknown) =>
  mutate({ eid: e.eid, name: 'task', comp: { [prop]: v } })

// The status pip IS the status control: a click cycles it through the
// board's column order (open → wip → done → open). A cycle, not a menu —
// three statuses in a fixed order is a shorter reach than any popup, and
// the task's verbs (right-click) still offer the direct moves for jumping
// straight to one.
export let Pip = ({ e }: { e: Ent }) => {
  let s = e.task!.status
  let g = gated(e)
  let next = statuses[(statuses.indexOf(s) + 1) % statuses.length]
  return (
    <Dot
      status={s}
      gated={g}
      class='Task_Pip'
      title={`${g ? 'blocked · ' : ''}→ ${next}`}
      onClick={() => set(e, 'status', next)}
    />
  )
}

// The head's fields, all through the registry door (editors.tsx Prop):
// the faces stay the board grammar's chips — Prio badge, domain chip,
// project link — while the registry supplies each type's editor from the
// vocabulary (number box, domain well, project search). The project's
// face is a LINK, so its press rides the ▾ handle beside it.
let Rank = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='priority'
    editable
    name='priority'
    show={(v) => <Prio p={Number(v ?? 0)} class='Task_Chip' />}
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

let Home = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='project_eid'
    editable
    handle
    name='project'
    show={(v) => {
      if (!v) return null
      let p = ent(String(v))
      return <Project {...linkProps(p)}>{p.doc?.title ?? p.kind}</Project>
    }}
  />
)

// The body is markdown: rendered as HTML (snarkdown; our own data, so no
// sanitizer between us and ourselves), double-click swaps in the raw
// source through the same <Edit>, and the blur that commits swaps the
// rendered view back. An empty body keeps a line of height to give the
// double-click somewhere to land.
export let TaskBody = ({ e, mod }: { e: Ent; mod?: string }) => {
  let [src, setSrc] = useState(false)
  return src
    ? (
      <Body mod={mod}>
        <Edit
          eid={e.eid}
          comp='doc'
          prop='body'
          multi
          open
          onClose={() => setSrc(false)}
        />
      </Body>
    )
    : (
      <Body
        mod={mod}
        onDblClick={() => setSrc(true)}
        dangerouslySetInnerHTML={{ __html: snarkdown(e.doc?.body ?? '') }}
      />
    )
}

// A single task: head, body, then its edges as Dependency sentences.
// Every field in the head is the field's editor — status cycles on the
// pip, prio/domain/project swap in a control where the chip stood.
export let Task = ({ e }: { e: Ent }) => (
  <Frame>
    <Head>
      <Pip e={e} />
      <Title>
        <Edit eid={e.eid} comp='doc' prop='title' />
      </Title>
      {e.claim && <Claim>⚑ {ent(e.claim.session_eid).session?.id}</Claim>}
      <Home e={e} />
      <Facet e={e} />
      <Rank e={e} />
      <Stamp e={e} />
      <View eid={e.eid} view='Id' />
    </Head>
    <TaskBody e={e} />
    <Above e={e} />
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    <Relate e={e} />
    <Runs e={e} />
    <Comments eid={e.eid} />
  </Frame>
)

// The reversed sentences: how each edge above reads from down here.
let up: Record<string, string> = {
  contains: 'part of',
  requires: 'required by',
  reads: 'read by',
}

// The view from below — every edge that holds this task, one reversed
// sentence each ('part of X', 'required by Y'), keeping the edge's color.
let Above = ({ e }: { e: Ent }) => (
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
  </>
)

// The task's sessions: every run that named this task (backlinks via
// session.requested_task_eid) plus the claim's holder — one row each, so
// a task is the door to the agents that worked it.
let Runs = ({ e }: { e: Ent }) => {
  let ids = new Set(
    backlinks(e.eid)
      .filter((b) => b.via == 'session.requested_task_eid')
      .map((b) => b.from),
  )
  if (e.claim) ids.add(e.claim.session_eid)
  if (!ids.size) return null
  return (
    <RunsEl>
      {[...ids].map((s) => <View key={s} eid={s} view='List.Item' />)}
    </RunsEl>
  )
}

// The same view in card context: the task IS the card, its head lives in
// the titlebar (Card.Title, where the dot edits status) — here a meta
// line (the board row's grammar: prio · domain · 💬 · ⚑), every field of
// it the same editor the full head carries, then the innards.
export let TaskCard = ({ e }: { e: Ent }) => {
  let talk = commentCount.value[e.eid]
  return (
    <>
      <Meta>
        <Rank e={e} />
        <Home e={e} />
        <Facet e={e} />
        {talk && <Talk>💬 {talk}</Talk>}
        {e.claim && <Claim>⚑ {ent(e.claim.session_eid).session?.id}</Claim>}
        <Stamp e={e} />
      </Meta>
      <TaskBody e={e} mod='bare' />
      <Above e={e} />
      {e.refs.map((r) => (
        <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
      ))}
      <Relate e={e} />
      <Comments eid={e.eid} />
    </>
  )
}
