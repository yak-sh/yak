import { useState } from 'preact/hooks'
import snarkdown from 'snarkdown'
import { type Ent } from '../../types.ts'
import {
  commentCount,
  domains,
  ent,
  gated,
  mutate,
  projects,
  statuses,
} from '../../live.ts'
import { linkProps } from '../nav.tsx'
import { block, focus, Stamp } from '../ui.tsx'
import { Comments } from '../Comments.tsx'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { Edit } from '../Edit.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'Task', {
  Head: 'div',
  Title: 'span',
  Body: 'p',
  Claim: 'span',
  Domain: 'span',
  Project: 'a',
  Caret: 'span',
  Field: 'input',
  Pick: 'select',
  Meta: 'div',
  Comments: 'span',
})
let {
  Head,
  Title,
  Body,
  Claim,
  Domain,
  Project,
  Caret,
  Field,
  Pick,
  Meta,
  Comments: Talk,
} = Frame

// Every field editor here commits through this one write: a single
// column, patched in place, down the normal mutate() path.
let set = (e: Ent, prop: string, v: unknown) =>
  mutate({ eid: e.eid, name: 'task', comp: { [prop]: v } })

// Enter commits — through blur, so there is ONE commit path, exactly as
// <Edit> does it. Escape puts the original value back and lets the
// statusbar's Escape blur us: the commit then sees nothing changed and
// writes nothing.
let keys = (ev: KeyboardEvent, was: string) => {
  let t = ev.currentTarget as HTMLInputElement
  if (ev.key == 'Enter') t.blur()
  else if (ev.key == 'Escape') t.value = was
}

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

// The Prio badge, editable: click swaps in a number box. priority is a
// REAL — the board's order, where a drop between two rows lands on 1.5 —
// so whatever number is typed is committed verbatim and no neighbour's
// value is touched. An empty box is not a zero: nothing typed, nothing
// written.
let Rank = ({ e }: { e: Ent }) => {
  let [edit, setEdit] = useState(false)
  let p = e.task!.priority
  let done = (ev: FocusEvent) => {
    let text = (ev.currentTarget as HTMLInputElement).value.trim()
    let v = Number(text)
    if (text && isFinite(v) && v != p) set(e, 'priority', v)
    setEdit(false)
  }
  return edit
    ? (
      <Field
        mod='num'
        type='number'
        step='1'
        value={p}
        elRef={focus}
        onKeyDown={(ev: KeyboardEvent) => keys(ev, String(p))}
        onBlur={done}
      />
    )
    : (
      <Prio
        p={p}
        class='Task_Chip'
        title='set priority'
        onClick={() => setEdit(true)}
      />
    )
}

// The domain chip, editable: click swaps in a text box whose <datalist>
// is the vocabulary the graph already uses (live.ts domains) — domain is
// free text by convention, so the list suggests and never limits. Empty
// commits null: clearing a facet is a real edit, and the one thing
// <Edit>'s revert-on-empty can't say. Unset, the chip is a dim ghost —
// a field you can't see is a field you can't set.
let Facet = ({ e }: { e: Ent }) => {
  let [edit, setEdit] = useState(false)
  let d = e.task!.domain ?? ''
  let list = `domains-${e.eid}`
  let done = (ev: FocusEvent) => {
    let text = (ev.currentTarget as HTMLInputElement).value.trim()
    if (text != d) set(e, 'domain', text || null)
    setEdit(false)
  }
  return edit
    ? (
      <>
        <Field
          type='text'
          list={list}
          value={d}
          placeholder='domain'
          elRef={focus}
          onKeyDown={(ev: KeyboardEvent) => keys(ev, d)}
          onBlur={done}
        />
        <datalist id={list}>
          {domains.value.map((x) => <option key={x} value={x} />)}
        </datalist>
      </>
    )
    : (
      <Domain
        mod={!d && 'empty'}
        title='set domain'
        onClick={() => setEdit(true)}
      >
        {d || '+ domain'}
      </Domain>
    )
}

// The project picker: every entity carrying the project tag, named by its
// doc title, plus a 'none' row that clears the field. A <select> is the
// picker — the platform's own keyboard and menu, the same control the Run
// door uses.
let Picker = ({ e, done }: { e: Ent; done: () => void }) => (
  <Pick
    elRef={focus}
    value={String(e.task!.project_eid ?? '')}
    onChange={(ev: Event) => {
      set(e, 'project_eid', (ev.target as HTMLSelectElement).value || null)
      done()
    }}
    onKeyDown={(ev: KeyboardEvent) => ev.key == 'Escape' && done()}
    onBlur={done}
  >
    <option value=''>none</option>
    {projects().map((p) => (
      <option key={p.eid} value={p.eid}>{p.doc?.title ?? p.kind}</option>
    ))}
  </Pick>
)

// The task's project, named and linked (the full internal-link contract)
// — so a click can't also open the picker; that's what the caret beside
// it is for. Unset, the caret IS the ghost chip: nothing to link to, so
// the whole affordance is one click.
let Home = ({ e }: { e: Ent }) => {
  let [pick, setPick] = useState(false)
  let peid = e.task?.project_eid
  let p = peid ? ent(String(peid)) : null
  if (pick) return <Picker e={e} done={() => setPick(false)} />
  return (
    <>
      {p && <Project {...linkProps(p)}>{p.doc?.title ?? p.kind}</Project>}
      <Caret
        mod={!p && 'empty'}
        title='set project'
        onClick={() => setPick(true)}
      >
        {p ? '▾' : '+ project'}
      </Caret>
    </>
  )
}

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
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    <Comments eid={e.eid} />
  </Frame>
)

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
      {e.refs.map((r) => (
        <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
      ))}
      <Comments eid={e.eid} />
    </>
  )
}
