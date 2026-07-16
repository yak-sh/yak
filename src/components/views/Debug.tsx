import { type Ent } from '../../types.ts'
import { View } from '../View.tsx'

// The Debug view: every card gets its tab, but WHAT renders depends on the
// entity — DebugTask knows tasks, DebugAny handles everything else — and
// each contained child renders through its OWN best Debug renderer, one
// level shallower, until depth runs out and the tail truncates.

// The comps an entity actually carries, minus the spine — the raw payload.
let comps = (e: Ent) => {
  let { eid: _e, num: _n, kind: _k, refs: _r, kids: _kids, ...rest } = e
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v))
}

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
      <span class='Debug_Kind'>{e.task!.status}</span>
    </div>
    <pre class='Debug_Raw'>{JSON.stringify(comps(e), null, 1)}</pre>
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
    <pre class='Debug_Raw'>{JSON.stringify(comps(e), null, 1)}</pre>
    <Kids e={e} depth={Number(depth)} />
  </div>
)
