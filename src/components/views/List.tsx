import { type Ent } from '../../types.ts'
import { unmime } from '../../rfc2047.ts'
import { boardAll, boardWindow, byWarmth, pinned } from '../../live.ts'
import { orderOf, parseQuery } from '../../query.ts'
import { block } from '../ui.tsx'
import { menuAt } from '../nav.tsx'
import { filterLine, passOf } from '../Filter.tsx'
import { dragData } from '../drag.ts'
import { useBoardSub, usePinTargets } from '../subscriptions.ts'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'
import { slot, tileLink, type TileProps, tileTitle } from '../Tile.tsx'
import { ListFrame } from '../ListFrame.tsx'

let { Row } = ListFrame

// A canvas as a linear list — every pinned card's target, one summary row
// each, id chips linking through. The mobile answer to a spatial plane.
// Rows are native draggables: dropped on a canvas they carry their PIN,
// so the existing card relocates there (the row IS that card, listed).
export let List = ({ e }: { e: Ent }) => {
  let pass = passOf(e.eid)
  // Each row paints a pin's TARGET with no Card around it, so this face holds
  // those rows itself — nothing else subscribes them (T-22371).
  let ps = pinned(e.eid)
  usePinTargets(ps)
  return (
    <ListFrame>
      {ps
        .toSorted((a, b) => b.z - a.z)
        .filter((p) => pass(p.target))
        .map((p) => (
          <Row
            key={p.eid}
            draggable
            onDragStart={(ev: DragEvent) =>
              dragData(ev, p.target, p.view, p.w, p.eid)}
          >
            <Entity eid={p.target} view='List.Tile' />
          </Row>
        ))}
    </ListFrame>
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
  useBoardSub(e)
  let pass = passOf(e.eid)
  let rows: Ent[]
  let hot = false
  try {
    hot = orderOf(parseQuery(String(e.board?.query ?? ''))) == 'hot'
    rows = boardAll(e).filter((t) => pass(t.eid))
      .toSorted(hot ? byWarmth(Date.now()) : byModified)
  } catch {
    return <ListFrame /> // a bad query already shows itself on the Board face
  }
  // The member sub is a WINDOW now (live.ts boardLine), so `rows` is a page of
  // the board and not the board. "+N more" counts against the total the server
  // STATED, or the feed would say "+300 more" while four thousand match — the
  // silent truncation this row exists to prevent. An ephemeral filter narrows
  // what's shown without the server knowing, so the stated total stops being
  // this feed's truth the moment the bar has anything in it.
  let win = filterLine(e.eid).trim() ? undefined : boardWindow(e)
  let shown = Math.min(CAP, rows.length)
  let more = Math.max(0, (win?.total ?? rows.length) - shown)
  return (
    <ListFrame>
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
    </ListFrame>
  )
}

// The default list line: title (or kind) + the id chip. The whole tile
// is the LINK — clickProps on the el: click peeks, double click
// navigates — and right-click serves the app menu (menuAt): navigation
// plus the entity's verbs. With no special List.Tile renderer, the registry
// falls through to each entity shape's plain Tile face.
let Line = block('div', 'ListTile', { Title: 'span' })
let summary = (e: Ent) =>
  (e.mail ? unmime(e.doc?.title ?? '') : e.doc?.title) ||
  e.doc?.body?.split('\n').find((line) => line.trim()) || e.kind

export let ListTile = ({ e, slots, onOpen }: TileProps) => (
  <Line {...tileLink(e, onOpen)} onContextMenu={menuAt(e)}>
    {slot(slots, 'before')}
    {/* a mail's stored subject may be an encoded-word — decode to read */}
    <Line.Title {...tileTitle(slots, summary(e))} />
    <Id e={e} />
    {slot(slots, 'after')}
    {slot(slots, 'body')}
  </Line>
)
