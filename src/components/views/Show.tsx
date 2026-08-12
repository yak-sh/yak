import { useEffect, useRef, useState } from 'preact/hooks'
import { type ComponentChildren } from 'preact'
import { comps, type Ent } from '../../types.ts'
import { FLOOR, textOf } from '../../embed.ts'
import {
  backlinks,
  base,
  boardsOver,
  commentCount,
  crewed,
  ent,
  gated,
  parents,
  pending,
  repoUrl,
  settled,
  statuses,
} from '../../live.ts'
import { linkProps } from '../nav.tsx'
import { block, Stamp } from '../ui.tsx'
import { Comments, viaName } from '../Comments.tsx'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { Edit } from '../Edit.tsx'
import { Markdown } from '../Markdown.tsx'
import { title, TitleEdit } from '../title.tsx'
import { editorFor, Prop } from '../editors.tsx'
import { Relate } from './Relate.tsx'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'
import { Icon } from '../icons.tsx'

// The lego box. A SECTION is an internal view ('Body', 'Meta',
// 'Dependencies', 'Runs', 'Comments' — registered in Entity.tsx like 'Id'
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
  Proposal: 'span',
  Deps: 'span',
  Done: 's',
  Mail: 'div',
  MailKey: 'span',
  MailVal: 'span',
  MailFault: 'span',
  Comments: 'span',
  Runs: 'div',
  Boards: 'div',
  Tasks: 'div',
  Similar: 'div',
  Kin: 'span',
  Score: 'span',
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
  Proposal,
  Deps,
  Done,
  Mail: MailEl,
  MailKey,
  MailVal,
  MailFault,
  Comments: Talk,
  Runs: RunsEl,
  Boards: BoardsEl,
  Tasks: TasksEl,
  Similar: SimilarEl,
  Kin,
  Score,
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
        live={crewed(e)}
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
// vocabulary (number box, domain well, project search).
let Rank = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='priority'
    editable
    name='priority'
    show={(_, v) => <Prio p={v} class='Show_Chip' />}
  />
)

let Facet = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='domain'
    editable
    name='domain'
    show={(face) => (face ? <Domain>{face}</Domain> : null)}
  />
)

// Who authored or edited this — the stamp supplies the sentence, while
// the prop registry supplies each actor's linked face.
let By = (
  { e, comp }: { e: Ent; comp: 'created' | 'updated' },
) =>
  e[comp]?.by
    ? (
      <Prop
        eid={e.eid}
        comp={comp}
        prop='by'
        show={(face, v) => {
          if (!face || !v) return null
          let a = ent(String(v))
          return <Assignee {...linkProps(a)}>{face}</Assignee>
        }}
      />
    )
    : null

// Whose plate: the assignee face is a LINK to the person (or the project
// standing in for its operator) — same grammar as Home. Claim (⚑, who's
// on it NOW) renders separately.
let Plate = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='assignee'
    editable
    handle
    name='assignee'
    show={(face, v) => {
      if (!face || !v) return null
      let a = ent(String(v))
      return <Assignee {...linkProps(a)} {...title(a.doc?.title || face)} />
    }}
  />
)

let Home = ({ e }: { e: Ent }) => (
  <Prop
    eid={e.eid}
    comp='task'
    prop='project'
    editable
    handle
    name='project'
    show={(face, v) => {
      if (!face || !v) return null
      let p = ent(String(v))
      return <Project {...linkProps(p)} {...title(p.doc?.title || face)} />
    }}
  />
)

let MailField = (
  { name, children }: { name: string; children: ComponentChildren },
) => (
  <>
    <MailKey>{name}</MailKey>
    <MailVal>{children}</MailVal>
  </>
)

// A letter says its envelope and receipt before its prose. Transport ids
// remain in Debug; Full carries the fields used to read and trust it.
export let Mail = ({ e }: { e: Ent }) => {
  let m = e.mail
  if (!m) return null
  let inbound = !!m.message_id
  // The send outcome is the shared delivered/error facet (D-14945), not a
  // mail column: delivered = sent, error = attempted-and-failed, neither =
  // pending. received_at stays on the row as the arrival DATA.
  let sent = e.delivered?.at
  let fault = e.error?.message
  return (
    <MailEl>
      <MailField name='from'>{m.from || '?'}</MailField>
      {!inbound && e.deliver?.to && e.deliver.to != m.to_addr &&
        <MailField name='requested'>{e.deliver.to}</MailField>}
      <MailField name='to'>{m.to_addr || e.deliver?.to || ''}</MailField>
      {inbound
        ? (
          <>
            <MailField name='received'>
              <Stamp at={m.received_at} />
            </MailField>
            <MailKey>verified</MailKey>
            <MailVal mod={m.verified ? 'verified' : 'unverified'}>
              {m.verified ? 'yes' : 'no'}
            </MailVal>
          </>
        )
        : sent
        ? (
          <MailField name='sent'>
            <Stamp at={sent} />
          </MailField>
        )
        : e.error
        ? (
          <MailField name='attempted'>
            <Stamp at={e.error.at} />
          </MailField>
        )
        : <MailField name='status'>pending</MailField>}
      {fault && <MailFault>{fault}</MailFault>}
    </MailEl>
  )
}

// ---- the sections ----

// The body is markdown: rendered as HTML (md.ts, which is where the
// text stops being able to speak HTML — a body can come from anyone who
// mails the fleet), double-click swaps in the raw source through the
// same <Edit>, and the blur that commits swaps the rendered view back.
// An empty body keeps a line of height to give the double-click
// somewhere to land.
export let Body = ({ e, mod }: { e: Ent; mod?: string }) => {
  let [src, setSrc] = useState(false)
  if (!e.doc) return null
  // A body this client was never shipped is not an empty one: paint the
  // wait and offer no editor until it lands (pending() is the ask).
  if (pending(e)) return <BodyEl mod={mod}>…</BodyEl>
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
      <Markdown
        as={BodyEl}
        mod={mod}
        onDblClick={() => setSrc(true)}
        text={e.doc?.body ?? ''}
        repo={repoUrl(e)}
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
      <Entity
        key={d.parent + d.type}
        eid={d.parent}
        view='Dependency'
        type={d.type}
        label={up[d.type] ?? d.type}
      />
    ))}
    {e.kids.map((k) => (
      <Entity key={k.eid} eid={k.eid} view='Dependency' type='contains' />
    ))}
    {e.refs.map((r) => (
      <Entity key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
  </>
)

// A comment's target is its first relationship sentence. Compose the
// ordinary edge rows too: comments remain entities and may carry edges of
// their own.
export let CommentDependencies = ({ e }: { e: Ent }) => (
  <>
    <Entity
      eid={e.comment!.target}
      view='Dependency'
      type='comment'
      label='on'
    />
    <Dependencies e={e} />
  </>
)

// The entity's sessions: every run that named it as requested work or its
// persistent role, plus the claim's holder — one row each, so a task or role
// is the door to the agents that served it.
export let Runs = ({ e }: { e: Ent }) => {
  let ids = new Set(
    backlinks(e.eid)
      .filter((b) => ['session.requested_task', 'session.role'].includes(b.via))
      .map((b) => b.from),
  )
  if (e.claim) ids.add(e.claim.session)
  if (!ids.size) return null
  return (
    <RunsEl>
      {[...ids].map((s) => <Entity key={s} eid={s} view='List.Tile' />)}
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
      {ids.map((b) => <Entity key={b} eid={b} view='List.Tile' />)}
    </BoardsEl>
  )
}

// The tasks homed here — every task whose project names this entity.
// Open work only, board-ordered (status column, then rank): the project
// page is a working view; the full history lives on its boards.
export let Tasks = ({ e }: { e: Ent }) => {
  let ids = backlinks(e.eid)
    .filter((b) => b.via == 'task.project')
    .map((b) => ent(b.from))
    .filter((t) => t.task && !settled(t.task.status))
    .sort((a, b) =>
      statuses.findIndex((s) => s == a.task!.status) -
        statuses.findIndex((s) => s == b.task!.status) ||
      a.task!.priority - b.task!.priority
    )
  if (!ids.length) return null
  return (
    <TasksEl>
      {ids.map((t) => <Entity key={t.eid} eid={t.eid} view='List.Tile' />)}
    </TasksEl>
  )
}

// Semantic kin — the dupe hint's other door (GET /similar, embed.ts):
// what the graph already says like this doc, above the twin floor,
// score-stamped. Vectors are derived data the server holds, so this
// section asks over HTTP per doc text; a box without the embedder
// (503), a dead server, or a bare doc all render nothing — never an
// error. Each row is the Dependency sentence — similarity read as a
// derived edge — with the cosine riding as a quiet stamp.
export let Similar = ({ e }: { e: Ent }) => {
  let [kin, setKin] = useState<{ eid: string; score: number }[]>([])
  let seq = useRef(0)
  let text = textOf(e.doc?.title, e.doc?.body)
  useEffect(() => {
    let mine = ++seq.current // a newer text owns the list
    let got = (hits: { eid: string; score: number }[]) => {
      if (mine == seq.current) setKin(hits.filter((h) => h.eid != e.eid))
    }
    if (!text) return got([])
    fetch(
      `${base()}/similar?q=${
        encodeURIComponent(text)
      }&eid=${e.eid}&limit=5&floor=${FLOOR}`,
    ).then((r) => (r.ok ? r.json() : []))
      .then(got, () => got([]))
  }, [text, e.eid])
  // A neighbor can die between sweeps — the cache, not the vector
  // table, says who still exists.
  let live = kin.filter((h) => ent(h.eid).num)
  if (!live.length) return null
  return (
    <SimilarEl>
      {live.map((h) => (
        <Kin key={h.eid}>
          <Entity eid={h.eid} view='Dependency' type='similar' />{' '}
          <Score>{h.score.toFixed(2)}</Score>
        </Kin>
      ))}
    </SimilarEl>
  )
}

// Each tally reads as a sentence, verb first — "requires ~2~ 1": two
// blockers already settled (struck — done or cancelled), one still open. A
// child that isn't a task can't be settled, so it counts as open. gated()
// tells the same story on the dot: only an open requires burns red.
let split = (kids: Ent[]): [number, number] => {
  let done = kids.filter((k) => settled(k.task?.status)).length
  return [kids.length - done, done]
}

let tallies = (e: Ent): [string, number, number][] => [
  [
    'requires',
    ...split(
      e.refs.filter((r) => r.type == 'requires').map((r) => ent(r.child)),
    ),
  ],
  ['contains', ...split(e.kids)],
  [
    'reads',
    ...split(
      e.refs.filter((r) => r.type == 'reads').map((r) => ent(r.child)),
    ),
  ],
]

let ProposalState = ({ e }: { e: Ent }) => {
  if (!e.proposed) return null
  let approved = !!e.decided
  let cancelled = !approved && e.task?.status == 'cancelled'
  let state = approved ? 'approved' : cancelled ? 'cancelled' : 'proposed'
  return (
    <Proposal mod={state} aria-label={state} data-tip={state}>
      <Icon name={approved ? 'stamp' : cancelled ? 'circle-x' : 'lightbulb'} />
    </Proposal>
  )
}

// The meta line — the union of the board row and Full's facts: prio · project
// · domain · edge tallies · comments · assignee · claim · age. Every field
// uses the same face everywhere and renders nothing when absent. In a card
// frame the titlebar carries title, pip, and id, so an empty line renders
// nothing; the document face and dense tile pass `id` to keep its chip here.
export let Meta = (
  { e, id, before, children }: {
    e: Ent
    id?: boolean
    before?: ComponentChildren
    children?: ComponentChildren
  },
) => {
  let talk = commentCount(e.eid).value
  let edges = tallies(e)
  let hasEdges = edges.some(([, open, done]) => open > 0 || done > 0)
  if (
    !id && !before && !children && !e.task && !e.proposed && !talk &&
    !e.claim &&
    !e.created?.at &&
    !hasEdges
  ) {
    return null
  }
  return (
    <MetaEl>
      {before}
      <ProposalState e={e} />
      {e.task && (
        <>
          <Rank e={e} />
          <Home e={e} />
          <Facet e={e} />
        </>
      )}
      {edges.map(([t, open, done]) =>
        (open > 0 || done > 0) && (
          <Deps key={t} mod={t}>
            {t}
            {done > 0 && (
              <>
                {' '}
                <Done>{done}</Done>
              </>
            )}
            {open > 0 && ` ${open}`}
          </Deps>
        )
      )}
      {talk > 0 && (
        <Talk>
          <Icon name='message-circle' />
          {talk}
        </Talk>
      )}
      {e.task && <Plate e={e} />}
      {e.claim && (
        <Claim {...linkProps(ent(e.claim.session))}>
          ⚑ {viaName(e.claim.session)}
        </Claim>
      )}
      <Stamp e={e} by={(comp) => <By e={e} comp={comp} />} />
      {id && <Id e={e} />}
      {children}
    </MetaEl>
  )
}

// Comments already speaks eid — a thin adapter gives it the section
// signature so it registers like the rest.
export let Talkback = ({ e }: { e: Ent }) => <Comments eid={e.eid} />

// ---- the one generic Full view: stack the sections ----

// The section stack, walked by both faces — change the order here,
// every doc-carrying entity follows.
let stack = [
  'Dependencies',
  'Relate',
  'Boards',
  'Tasks',
  'Runs',
  'Similar',
  'Comments',
]

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
        <TitleEdit eid={e.eid} />
      </Title>
    </Heading>
    <Entity eid={e.eid} view='Meta' id />
    <Entity eid={e.eid} view='Mail' />
    <Entity eid={e.eid} view='Body' />
    {stack.map((v) => <Entity key={v} eid={e.eid} view={v} />)}
  </Frame>
)

// The card face (Card.Full): the titlebar is the head — the meta line
// stands in.
export let CardFull = ({ e }: { e: Ent }) => (
  <>
    <Entity eid={e.eid} view='Meta' />
    <Entity eid={e.eid} view='Mail' />
    <Entity eid={e.eid} view='Body' mod='bare' />
    {stack.map((v) => <Entity key={v} eid={e.eid} view={v} />)}
  </>
)

export { Relate }
