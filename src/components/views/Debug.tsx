import { type Ent } from '../../types.ts'
import { View } from '../View.tsx'

// The Debug view: one full inspector for the entity itself — EVERY prop,
// nothing hidden — with contained children as one linked Debug.ListItem row
// each (a board full of tasks stays a list, not an explosion). The per-kind
// dispatch lives in Debug.ListItem: tasks get the status row, everything
// else the generic one; the inspector's own head is its ListItem too.

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
    ? 'Debug_Val Debug_Val-num'
    : typeof v == 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}/.test(v)
    ? 'Debug_Val Debug_Val-id'
    : 'Debug_Val'

let Row = ({ comp, k, v }: { comp?: string; k: string; v: unknown }) => (
  <>
    <span class='Debug_Key'>
      {comp && <span class='Debug_Comp'>{comp}.</span>}
      {k}
    </span>
    <span class={shape(v)}>{String(v)}</span>
  </>
)

// EVERY prop as a key → value grid row — the spine (eid, num, kind), then
// each component whole ('pin.x  664'). Debug hides nothing.
let Props = ({ e }: { e: Ent }) => (
  <div class='Debug_Props'>
    <Row k='eid' v={e.eid} />
    <Row k='num' v={e.num} />
    <Row k='kind' v={e.kind} />
    {comps(e).flatMap(([name, comp]) =>
      Object.entries(comp).map(([k, v]) => <Row comp={name} k={k} v={v} />)
    )}
  </div>
)

export let Debug = ({ e }: { e: Ent }) => (
  <div class='Debug'>
    <View eid={e.eid} view='Debug.ListItem' />
    <Props e={e} />
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    {e.kids.length > 0 && (
      <div class='Debug_Kids'>
        {e.kids.map((k) => (
          <View key={k.eid} eid={k.eid} view='Debug.ListItem' />
        ))}
      </div>
    )}
  </div>
)

export let DebugTaskItem = ({ e }: { e: Ent }) => (
  <div class='Debug_Item'>
    <View eid={e.eid} view='Id' />
    <span class='Debug_Kind'>{e.kind}</span>
    <span class='Debug_Title'>{e.task!.title}</span>
    <span class={`Debug_Status Debug_Status-${e.task!.status}`}>
      {e.task!.status}
    </span>
  </div>
)

export let DebugAnyItem = ({ e }: { e: Ent }) => (
  <div class='Debug_Item'>
    <View eid={e.eid} view='Id' />
    <span class='Debug_Kind'>{e.kind}</span>
    {e.project?.title && <span class='Debug_Title'>{e.project.title}</span>}
  </div>
)
