import { type Change, type Ent } from '../../types.ts'
import { byWarmth, ent, mutate, relations } from '../../live.ts'
import { link, unlink } from '../../edge.ts'
import { block } from '@yaks/ui'
import { dragData } from '../drag.ts'
import { Chat } from '../Chat.tsx'
import { Entity } from '../Entity.tsx'
import { useQuery } from '../useQuery.ts'

let Frame = block('div', 'Persona', {
  Tiers: 'div',
  Sec: 'div',
  SecName: 'div',
  Count: 'span',
  Row: 'div',
  Empty: 'div',
  Lint: 'div',
})
let { Tiers, Sec, SecName, Count, Row, Empty, Lint } = Frame

// The persona's tiers, editable by drag: three sections — Preload
// (persona `contains` X: the whole body rides every materialization),
// Index (persona `reads` X: one recall line), and the in-scope memories
// not yet tiered (searchable only). A row dropped on another section
// flips its edge; dropped on Untiered it sheds both; dragged out to the
// canvas it spawns a card like any list row. A doc on BOTH tiers is a
// lint line, not an error — preload wins at render, but say so. Beside the
// tiers, as beside any document, is the chat: on a persona it messages it.
let TIERS = [
  ['contains', 'Preload', 'whole body in every materialization'],
  ['reads', 'Index', 'one recall line'],
  [null, 'Untiered', 'in scope, searchable only'],
] as const

/** The query for the memories in a persona's scope, through the indexed
 * memory.scope, so the Untiered section never scans the partial cache. A
 * homeless persona's are the memories scoped to no project. */
export let inScope = (persona?: { home?: string | null }): string =>
  persona?.home ? `.memory.scope=${persona.home}` : '.memory !memory.scope'

export let Persona = ({ e }: { e: Ent }) => {
  let now = Date.now()
  let mine = relations(e.eid).value
  let linked = (t: string) =>
    mine.filter((d) => d.type == t)
      .map((d) => ent(d.child))
      .filter((r) => r.doc)
      .toSorted(byWarmth(now))
  let pre = linked('contains')
  let idx = linked('reads')
  let tiered = new Set([...pre, ...idx].map((r) => r.eid))
  let scoped = useQuery(inScope(e.persona))
  let loose = scoped
    .filter((r) => r.memory && r.doc && !tiered.has(r.eid))
    .toSorted(byWarmth(now))
  let both = pre.filter((r) => idx.some((x) => x.eid == r.eid))

  let drop = (ev: DragEvent, tier: 'contains' | 'reads' | null) => {
    let data = ev.dataTransfer?.getData('application/x-tasks-card')
    if (!data) return
    let { target } = JSON.parse(data)
    if (target == e.eid || !ent(target).doc) return // nothing to say
    ev.preventDefault()
    ev.stopPropagation()
    let has = (t: string) => mine.some((d) => d.type == t && d.child == target)
    let batch: Change[] = []
    for (let t of ['contains', 'reads']) {
      if (t != tier && has(t)) batch.push(...unlink(e.eid, t, target))
    }
    if (tier && !has(tier)) batch.push(...link(e.eid, tier, target))
    if (batch.length) mutate(...batch)
  }

  let rows = (t: (typeof TIERS)[number][0]) =>
    t == 'contains' ? pre : t == 'reads' ? idx : loose
  return (
    <Frame>
      <Tiers>
        {both.length > 0 && (
          <Lint>
            ⚠ on both tiers (preload wins):{' '}
            {both.map((r, i) => (
              <span key={r.eid}>
                {i ? ', ' : ''}
                <Entity eid={r.eid} view='Persona.Lint.Inline' />
              </span>
            ))} — drop each on one to settle
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
                <Entity eid={r.eid} view='List.Tile' />
              </Row>
            ))}
            {!rows(t).length && <Empty>drop here — {hint}</Empty>}
          </Sec>
        ))}
      </Tiers>
      <Chat e={e} />
    </Frame>
  )
}
