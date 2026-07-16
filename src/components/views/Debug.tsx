import { type Ent } from '../../types.ts'
import { block } from '../ui.tsx'
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
  Kids: 'div',
})
let { Props: Grid, Key, Comp, Val, Item, Kind, Title, Status, Kids } = Frame

// The comps an entity actually carries, minus the spine — the raw payload.
let comps = (e: Ent) => {
  let { eid: _e, num: _n, kind: _k, refs: _r, kids: _kids, ...rest } = e
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

let Row = ({ comp, k, v }: { comp?: string; k: string; v: unknown }) => (
  <>
    <Key>
      {comp && <Comp>{comp}.</Comp>}
      {k}
    </Key>
    <Val mod={shape(v)}>{String(v)}</Val>
  </>
)

// EVERY prop as a key → value grid row — the spine (eid, num, kind), then
// each component whole ('pin.x  664'). Debug hides nothing.
let AllProps = ({ e }: { e: Ent }) => (
  <Grid>
    <Row k='eid' v={e.eid} />
    <Row k='num' v={e.num} />
    <Row k='kind' v={e.kind} />
    {comps(e).flatMap(([name, comp]) =>
      Object.entries(comp).map(([k, v]) => (
        <Row key={`${name}.${k}`} comp={name} k={k} v={v} />
      ))
    )}
  </Grid>
)

export let Debug = ({ e }: { e: Ent }) => (
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
  </Frame>
)

export let DebugTaskItem = ({ e }: { e: Ent }) => (
  <Item>
    <View eid={e.eid} view='Id' />
    <Kind>{e.kind}</Kind>
    <Title>{e.task!.title}</Title>
    <Status mod={e.task!.status}>{e.task!.status}</Status>
  </Item>
)

export let DebugAnyItem = ({ e }: { e: Ent }) => (
  <Item>
    <View eid={e.eid} view='Id' />
    <Kind>{e.kind}</Kind>
    {e.project?.title && <Title>{e.project.title}</Title>}
  </Item>
)
