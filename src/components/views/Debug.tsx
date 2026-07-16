import { type Ent } from '../../types.ts'
import { View } from '../View.tsx'

// The Debug view: every card gets its tab, but WHAT renders depends on the
// entity — DebugTask knows tasks, DebugAny handles everything else — and
// each contained child renders through its OWN best Debug renderer, one
// level shallower, until depth runs out and the tail truncates.

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

let Kids = ({ e, depth }: { e: Ent; depth: number }) =>
  depth > 0
    ? (
      <>
        {e.kids.map((k) => (
          <View key={k.eid} eid={k.eid} view='Debug' depth={depth - 1} />
        ))}
      </>
    )
    : (
      <>
        {e.kids.length > 0 && (
          <span class='Debug_More'>… {e.kids.length} contained</span>
        )}
      </>
    )

export let DebugTask = (
  { e, depth = 2 }: { e: Ent; [x: string]: unknown },
) => (
  <div class='Debug'>
    <div class='Debug_Head'>
      <View eid={e.eid} view='Id' />
      <span class='Debug_Kind'>{e.kind}</span>
      <span>{e.task!.title}</span>
      <span class={`Debug_Status Debug_Status-${e.task!.status}`}>
        {e.task!.status}
      </span>
    </div>
    <Props e={e} />
    {e.refs.map((r) => (
      <View key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    <Kids e={e} depth={Number(depth)} />
  </div>
)

export let DebugAny = ({ e, depth = 2 }: { e: Ent; [x: string]: unknown }) => (
  <div class='Debug'>
    <div class='Debug_Head'>
      <View eid={e.eid} view='Id' />
      <span class='Debug_Kind'>{e.kind}</span>
    </div>
    <Props e={e} />
    <Kids e={e} depth={Number(depth)} />
  </div>
)
