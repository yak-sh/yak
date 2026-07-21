import { type Ent, idOf } from '../../types.ts'
import { boardAll, byWarmth, pinned } from '../../live.ts'
import { orderOf, parseQuery } from '../../query.ts'
import { block } from '../ui.tsx'
import { menu } from '../nav.tsx'
import { View } from '../View.tsx'

let Frame = block('div', 'List', { Row: 'div' })
let { Row } = Frame

// A canvas as a linear list — every pinned card's target, one summary row
// each, id chips linking through. The mobile answer to a spatial plane.
export let List = ({ e }: { e: Ent }) => (
  <Frame>
    {pinned(e.eid)
      .toSorted((a, b) => b.z - a.z)
      .map((p) => (
        <Row key={p.eid}>
          <View eid={p.target_eid} view='List.Item' />
        </Row>
      ))}
  </Frame>
)

// A board as a linear FEED — its query run over the whole graph, not
// just tasks (that's the Board face's job). The Front page (.order=hot)
// reads as the graph-wide feed: warm first; any other board lists by
// recency. Capped loudly — a "+N more" row, never silent truncation.
let CAP = 100
let byModified = (a: Ent, b: Ent) =>
  String(b.modified_at ?? '').localeCompare(String(a.modified_at ?? '')) ||
  (b.num - a.num)
export let BoardList = ({ e }: { e: Ent }) => {
  let rows: Ent[]
  let hot = false
  try {
    hot = orderOf(parseQuery(String(e.board?.query ?? ''))) == 'hot'
    rows = boardAll(e).toSorted(hot ? byWarmth(Date.now()) : byModified)
  } catch {
    return <Frame /> // a bad query already shows itself on the Board face
  }
  let more = rows.length - CAP
  return (
    <Frame>
      {rows.slice(0, CAP).map((t) => (
        <Row key={t.eid}>
          <View eid={t.eid} view='List.Item' />
        </Row>
      ))}
      {more > 0 && <Row mod='more'>+{more} more</Row>}
    </Frame>
  )
}

// The default list line: title (or kind) + the linking id chip. Tasks
// override with Task.Row via the registry. Right-click for the entity's
// verbs, same as any card.
let Line = block('div', 'ListItem', { Title: 'span' })
export let ListItem = ({ e }: { e: Ent }) => (
  <Line
    onContextMenu={(ev: MouseEvent) => {
      if (ev.target instanceof Element && ev.target.closest('a')) return
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
    <Line.Title>{e.doc?.title || e.kind}</Line.Title>
    <View eid={e.eid} view='Id' />
  </Line>
)
