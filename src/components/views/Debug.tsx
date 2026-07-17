import { comps as vocab, type Ent } from '../../types.ts'
import { backlinks, ent } from '../../live.ts'
import { block } from '../ui.tsx'
import { Prop } from '../editors.tsx'
import { View } from '../View.tsx'

// The Debug view: one full inspector for the entity itself — EVERY prop,
// nothing hidden — with contained children as one linked Debug.ListItem row
// each (a board full of tasks stays a list, not an explosion). The per-kind
// dispatch lives in Debug.ListItem: tasks get the status row, everything
// else the generic one; the inspector's own head is its ListItem too.

let Frame = block('div', 'Debug', {
  Props: 'div',
  Key: 'span',
  Comp: 'span',
  Val: 'span',
  Item: 'div',
  Kind: 'span',
  Title: 'span',
  Status: 'span',
  Claim: 'span',
  Prio: 'span',
  Kids: 'div',
  Linked: 'div',
  Via: 'span',
})
let {
  Props: Grid,
  Key,
  Comp,
  Val,
  Item,
  Kind,
  Title,
  Status,
  Claim,
  Prio,
  Kids,
  Linked,
  Via,
} = Frame

// The comps an entity actually carries, minus the spine — the raw payload.
// created_at/modified_at are spine too: leaving a bare STRING in the rest
// makes Object.entries spell it out per character (created_at.0 = '2'…).
let comps = (e: Ent) => {
  let {
    eid: _e,
    num: _n,
    kind: _k,
    refs: _r,
    kids: _kids,
    created_at: _c,
    modified_at: _m,
    ...rest
  } = e
  return Object.entries(rest).filter(([, v]) => v) as [
    string,
    Record<string, unknown>,
  ][]
}

// Values color by shape: numbers, uuids, everything else.
let shape = (v: unknown) =>
  typeof v == 'number'
    ? 'num'
    : typeof v == 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}/.test(v)
    ? 'id'
    : false

// null and '' still get a row — debug hides nothing, including absence.
let Row = ({ comp, k, v }: { comp?: string; k: string; v: unknown }) => (
  <>
    <Key>
      {comp && <Comp>{comp}.</Comp>}
      {k}
    </Key>
    {v == null || v === ''
      ? <Val mod='nil'>{v === '' ? '""' : 'null'}</Val>
      : <Val mod={shape(v)}>{String(v)}</Val>}
  </>
)

// EVERY stored prop as a key → value grid row — the spine (eid, num),
// then each component whole ('pin.x  664'). kind is NOT here: it's
// derived, not data, and the summary line above already says it.
// Wire-writable props render through <Prop editable> — the typed
// vocabulary picks each one's editor, so the WHOLE entity is editable
// here with the right control and zero per-kind code; server-owned
// columns stay the plain read they are.
let AllProps = ({ e }: { e: Ent }) => (
  <Grid>
    <Row k='eid' v={e.eid} />
    <Row k='num' v={e.num} />
    {comps(e).flatMap(([name, comp]) =>
      Object.entries(comp).map(([k, v]) =>
        k in (vocab[name] ?? {})
          ? (
            <>
              <Key>
                <Comp>{name}.</Comp>
                {k}
              </Key>
              <Prop eid={e.eid} comp={name} prop={k} editable />
            </>
          )
          : <Row key={`${name}.${k}`} comp={name} k={k} v={v} />
      )
    )}
  </Grid>
)

export let Debug = ({ e }: { e: Ent }) => {
  // Incoming references too: whatever in the cache points here, said by
  // which prop brought it (live.ts backlinks, derived from the typed
  // vocabulary — sessions on their task, cards on their target, …).
  let links = backlinks(e.eid)
  return (
    <Frame>
      <View eid={e.eid} view='Debug.ListItem' />
      <AllProps e={e} />
      {e.refs.map((r) => (
        <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
      ))}
      {e.kids.length > 0 && (
        <Kids>
          {e.kids.map((k) => (
            <View key={k.eid} eid={k.eid} view='Debug.ListItem' />
          ))}
        </Kids>
      )}
      {links.length > 0 && (
        <Kids>
          {links.map((b) => (
            <Linked key={b.from + b.via}>
              <Via>← {b.via}</Via>
              <View eid={b.from} view='Debug.ListItem' />
            </Linked>
          ))}
        </Kids>
      )}
    </Frame>
  )
}

export let DebugTaskItem = ({ e }: { e: Ent }) => (
  <Item>
    <View eid={e.eid} view='Id' />
    <Kind>{e.kind}</Kind>
    <Title>{e.doc?.title}</Title>
    {e.claim && <Claim>⚑ {ent(e.claim.session_eid).session?.id}</Claim>}
    <Prio>p{e.task!.priority}</Prio>
    <Status mod={e.task!.status}>{e.task!.status}</Status>
  </Item>
)

export let DebugAnyItem = ({ e }: { e: Ent }) => (
  <Item>
    <View eid={e.eid} view='Id' />
    <Kind>{e.kind}</Kind>
    {e.doc?.title && <Title>{e.doc.title}</Title>}
  </Item>
)
