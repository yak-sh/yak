import { type Change, type Ent } from '../../types.ts'
import { byWarmth, cache, deps, ent, mutate } from '../../live.ts'
import { block } from '../ui.tsx'
import { dragData } from '../drag.ts'
import { View } from '../View.tsx'

let Frame = block('div', 'Persona', {
  Sec: 'div',
  SecName: 'div',
  Count: 'span',
  Row: 'div',
  Empty: 'div',
  Lint: 'div',
})
let { Sec, SecName, Count, Row, Empty, Lint } = Frame

// The persona's tiers, editable by drag: three sections — Preload
// (persona `contains` X: the whole body rides every materialization),
// Index (persona `reads` X: one recall line), and the in-scope memories
// not yet tiered (searchable only). A row dropped on another section
// flips its edge; dropped on Untiered it sheds both; dragged out to the
// canvas it spawns a card like any list row. A doc on BOTH tiers is a
// lint line, not an error — preload wins at render, but say so.
let TIERS = [
  ['contains', 'Preload', 'whole body in every materialization'],
  ['reads', 'Index', 'one recall line'],
  [null, 'Untiered', 'in scope, searchable only'],
] as const

export let Persona = ({ e }: { e: Ent }) => {
  let now = Date.now()
  let mine = deps.value.filter((d) => d.parent == e.eid)
  let linked = (t: string) =>
    mine.filter((d) => d.type == t)
      .map((d) => ent(d.child))
      .filter((r) => r.doc)
      .toSorted(byWarmth(now))
  let pre = linked('contains')
  let idx = linked('reads')
  let tiered = new Set([...pre, ...idx].map((r) => r.eid))
  // In scope = memories sharing the persona's home (fleet personas draw
  // from unscoped memories); already-tiered ones show in their tier.
  let home = e.persona?.home_eid ?? null
  let loose = Object.keys(cache.value).map(ent)
    .filter((r) =>
      r.memory && r.doc && !tiered.has(r.eid) &&
      (r.memory.scope_eid ?? null) == home
    )
    .toSorted(byWarmth(now))
  let both = pre.filter((r) => idx.some((x) => x.eid == r.eid))

  let drop = (ev: DragEvent, tier: 'contains' | 'reads' | null) => {
    let data = ev.dataTransfer?.getData('application/x-tasks-card')
    if (!data) return
    let { target_eid } = JSON.parse(data)
    if (target_eid == e.eid || !ent(target_eid).doc) return // nothing to say
    ev.preventDefault()
    ev.stopPropagation()
    let has = (t: string) =>
      mine.some((d) => d.type == t && d.child == target_eid)
    let batch: Change[] = []
    for (let t of ['contains', 'reads']) {
      if (t != tier && has(t)) {
        batch.push({
          eid: e.eid,
          name: 'dependency',
          comp: { type: t, child_eid: target_eid, gone: true },
        })
      }
    }
    if (tier && !has(tier)) {
      batch.push({
        eid: e.eid,
        name: 'dependency',
        comp: { type: tier, child_eid: target_eid },
      })
    }
    if (batch.length) mutate(...batch)
  }

  let rows = (t: (typeof TIERS)[number][0]) =>
    t == 'contains' ? pre : t == 'reads' ? idx : loose
  return (
    <Frame>
      {both.length > 0 && (
        <Lint>
          ⚠ on both tiers (preload wins):{' '}
          {both.map((r) => r.doc?.title || r.kind).join(', ')}{' '}
          — drop each on one to settle
        </Lint>
      )}
      {TIERS.map(([t, name, hint]) => (
        <Sec
          key={name}
          // the drop target cancels dragover ITSELF (Board.tsx says why)
          onDragOver={(ev: DragEvent) => ev.preventDefault()}
          onDrop={(ev: DragEvent) => drop(ev, t)}
        >
          <SecName title={hint}>
            {name}
            <Count>{rows(t).length}</Count>
          </SecName>
          {rows(t).map((r) => (
            <Row
              key={r.eid}
              draggable
              onDragStart={(ev: DragEvent) => dragData(ev, r.eid, 'Full')}
            >
              <View eid={r.eid} view='List.Tile' />
            </Row>
          ))}
          {!rows(t).length && <Empty>drop here — {hint}</Empty>}
        </Sec>
      ))}
    </Frame>
  )
}
