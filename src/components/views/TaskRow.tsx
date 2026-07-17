import { type Ent, idOf } from '../../types.ts'
import { commentCount, gated } from '../../live.ts'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { block } from '../ui.tsx'
import { menu } from '../nav.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'TaskRow', {
  Title: 'span',
  Meta: 'div',
  Domain: 'span',
  Comments: 'span',
  Claim: 'span',
  Deps: 'span',
})
let { Title, Meta, Domain, Comments, Claim, Deps } = Frame

// A task as a small board card, Trello-shaped: wrapping title beside its
// dot, then one meta line — priority, domain, edge tallies ("2 requires",
// edge-colored), comment tally, claim flag, linking id. Plain spans only
// (no editors, no markdown): hundreds of these must render without the
// browser noticing. Right-click for the task's verbs; drag out to the
// canvas for the full Task card.
export let TaskRow = ({ e }: { e: Ent }) => {
  let talk = commentCount.value[e.eid]
  let edges: [string, number][] = [
    ['requires', e.refs.filter((r) => r.type == 'requires').length],
    ['contains', e.kids.length],
    ['reads', e.refs.filter((r) => r.type == 'reads').length],
  ]
  return (
    <Frame
      onContextMenu={(ev: MouseEvent) => {
        if (
          ev.target instanceof Element &&
          ev.target.closest('a, input, textarea, [contenteditable]')
        ) return
        ev.preventDefault()
        ev.stopPropagation()
        menu.value = {
          x: ev.clientX,
          y: ev.clientY,
          href: `/${idOf(e)}`,
          eid: e.eid,
        }
      }}
    >
      <Dot status={e.task!.status} gated={gated(e)} />
      <Title>{e.doc?.title}</Title>
      <Meta>
        <Prio p={e.task!.priority} />
        {e.task!.domain && <Domain>{e.task!.domain}</Domain>}
        {edges.map(([t, n]) => n > 0 && <Deps key={t} mod={t}>{n} {t}</Deps>)}
        {talk && <Comments>💬 {talk}</Comments>}
        {e.claim && <Claim>⚑</Claim>}
        <View eid={e.eid} view='Id' />
      </Meta>
    </Frame>
  )
}
