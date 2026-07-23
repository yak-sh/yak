import { type Ent, idOf } from '../../types.ts'
import { unmime } from '../../rfc2047.ts'
import { boardAll, byWarmth, pinned } from '../../live.ts'
import { orderOf, parseQuery } from '../../query.ts'
import { block } from '../ui.tsx'
import { passOf } from '../Filter.tsx'
import { dragData } from '../drag.ts'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'

let Frame = block('div', 'List', { Row: 'div' })
let { Row } = Frame

// A canvas as a linear list — every pinned card's target, one summary row
// each, id chips linking through. The mobile answer to a spatial plane.
// Rows are native draggables: dropped on a canvas they carry their PIN,
// so the existing card relocates there (the row IS that card, listed).
export let List = ({ e }: { e: Ent }) => {
  let pass = passOf(e.eid)
  return (
    <Frame>
      {pinned(e.eid)
        .toSorted((a, b) => b.z - a.z)
        .filter((p) => pass(p.target_eid))
        .map((p) => (
          <Row
            key={p.eid}
            draggable
            onDragStart={(ev: DragEvent) =>
              dragData(ev, p.target_eid, p.view, p.w, p.eid)}
          >
            <Entity eid={p.target_eid} view='List.Tile' />
          </Row>
        ))}
    </Frame>
  )
}

// A board as a linear FEED — its query run over the whole graph, not
// just tasks (that's the Board face's job). The Front page (.order=hot)
// reads as the graph-wide feed: warm first; any other board lists by
// recency. Capped loudly — a "+N more" row, never silent truncation.
let CAP = 100
let touchedAt = (e: Ent) => e.updated?.at ?? e.created?.at ?? ''
let byModified = (a: Ent, b: Ent) =>
  String(touchedAt(b)).localeCompare(String(touchedAt(a))) ||
  (b.num - a.num)
export let BoardList = ({ e }: { e: Ent }) => {
  let pass = passOf(e.eid)
  let rows: Ent[]
  let hot = false
  try {
    hot = orderOf(parseQuery(String(e.board?.query ?? ''))) == 'hot'
    rows = boardAll(e).filter((t) => pass(t.eid))
      .toSorted(hot ? byWarmth(Date.now()) : byModified)
  } catch {
    return <Frame /> // a bad query already shows itself on the Board face
  }
  let more = rows.length - CAP
  return (
    <Frame>
      {rows.slice(0, CAP).map((t) => (
        // a feed row dragged onto a canvas spawns the entity as a card
        <Row
          key={t.eid}
          draggable
          onDragStart={(ev: DragEvent) => dragData(ev, t.eid, 'Full')}
        >
          <Entity eid={t.eid} view='List.Tile' />
        </Row>
      ))}
      {more > 0 && <Row mod='more'>+{more} more</Row>}
    </Frame>
  )
}

// The default list line: title (or kind) + the id chip. The whole tile
// is the LINK — href on the el, the anchor promotion does the rest — so
// the browser's own context menu serves it; the verbs menu belongs to
// the card. Tasks override List.Tile via the registry (TaskTile).
let Line = block('div', 'ListTile', { Title: 'span' })
export let ListTile = ({ e }: { e: Ent }) => (
  <Line href={`/${idOf(e)}`}>
    {/* a mail's stored subject may be an encoded-word — decode to read */}
    <Line.Title>
      {(e.mail ? unmime(e.doc?.title ?? '') : e.doc?.title) || e.kind}
    </Line.Title>
    <Id e={e} />
  </Line>
)
