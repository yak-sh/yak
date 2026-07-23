import { type Ent, idOf } from '../../types.ts'
import { commentCount, ent, gated, settled } from '../../live.ts'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { block } from '../ui.tsx'
import { menu } from '../nav.tsx'
import { Id } from './Inline.tsx'

let Frame = block('div', 'TaskRow', {
  Title: 'span',
  Meta: 'div',
  Domain: 'span',
  Comments: 'span',
  Claim: 'span',
  Assignee: 'span',
  Deps: 'span',
  Done: 's',
})
let { Title, Meta, Domain, Comments, Claim, Assignee, Deps, Done } = Frame

// A task as a small board card, Trello-shaped: wrapping title beside its
// dot, then one meta line — priority, domain, edge tallies ("2 requires",
// edge-colored), comment tally, claim flag, linking id. Plain spans only
// (no editors, no markdown): hundreds of these must render without the
// browser noticing. Right-click for the task's verbs; drag out to the
// canvas for the full Task card.
export let TaskRow = ({ e }: { e: Ent }) => {
  let talk = commentCount.value[e.eid]
  // Each tally reads as a sentence, verb first — "requires ~2~ 1": two
  // blockers already settled (struck — done or cancelled), one still
  // open. A child that isn't a task can't be settled, so it counts as
  // open. gated() tells the same story on the dot: only an open requires
  // burns red.
  let split = (kids: Ent[]): [number, number] => {
    let done = kids.filter((k) => settled(k.task?.status)).length
    return [kids.length - done, done]
  }
  let edges: [string, number, number][] = [
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
        {talk && <Comments>💬 {talk}</Comments>}
        {e.task!.assignee_eid && (
          <Assignee>{ent(e.task!.assignee_eid).doc?.title}</Assignee>
        )}
        {e.claim && <Claim>⚑</Claim>}
        <Id e={e} />
      </Meta>
    </Frame>
  )
}
