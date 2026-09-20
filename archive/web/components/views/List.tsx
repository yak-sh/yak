import { type Ent } from '../../types.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { unmime } from '../../rfc2047.ts'
import { boardPost, byWarmth, ent, pinned, subWindow } from '../../live.ts'
import { orderOf, parseQuery, windowOf } from '../../query.ts'
import { block } from '../ui.tsx'
import { menuAt } from '../nav.tsx'
import { filteredQuery, usePassOf } from '../Filter.tsx'
import { dragData } from '../drag.ts'
import { usePinTargets } from '../subscriptions.ts'
import { useQueryResult } from '../useQuery.ts'
import { Id } from './Inline.tsx'
import { Entity } from '../Entity.tsx'
import { slot, tileLink, type TileProps, tileTitle } from '../Tile.tsx'
import { ListFrame } from '../ListFrame.tsx'
import { SubscriptionFailure } from '../SubscriptionFailure.tsx'

let { Row } = ListFrame

// A canvas as a linear list — every pinned card's target, one summary row
// each, id chips linking through. The mobile answer to a spatial plane.
// Rows are native draggables: dropped on a canvas they carry their PIN,
// so the existing card relocates there (the row IS that card, listed).
export let List = ({ e }: { e: Ent }) => {
  let pass = usePassOf(e.eid)
  // Each row paints a pin's TARGET with no Card around it, so this face holds
  // those rows itself — nothing else subscribes them (T-22371).
  let ps = pinned(e.eid)
  usePinTargets(ps)
  if (pass.subscription?.state.status == 'failed') {
    return (
      <ListFrame>
        <SubscriptionFailure read={pass.subscription} />
      </ListFrame>
    )
  }
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
let touchedAt = (e: Ent) => e.updated?.at ?? e.created?.at ?? ''
let byModified = (a: Ent, b: Ent) =>
  String(touchedAt(b)).localeCompare(String(touchedAt(a))) ||
  (b.num - a.num)
export let BoardList = ({ e }: { e: Ent }) => {
  let root = useRef<HTMLDivElement>(null)
  let [size, setSize] = useState(0)
  let [limit, setLimit] = useState(0)
  let query = filteredQuery(e.eid, String(e.board?.query ?? ''))
  useLayoutEffect(() => {
    let node = root.current?.parentElement
    let measure = () =>
      setSize(Math.max(4, Math.ceil((node?.clientHeight || 480) / 64) + 2))
    measure()
    if (!node || !globalThis.ResizeObserver) return
    let observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setLimit(0), [e.eid, query])
  let line = query
  let bound = Infinity
  try {
    bound = windowOf(parseQuery(query)).limit ?? Infinity
    line += '&.limit=' + Math.min(bound, Math.max(size, limit)) +
      '&.edges.peers=task.status,doc.title&.edges.limit=' +
      Math.max(size, limit) * 4
  } catch { /* the addressed query reports its refusal */ }
  let page = useQueryResult(line, !!query.trim() && size > 0, true)
  let boardRead = page.subscription
  let win = boardRead ? subWindow(boardRead.sub) : undefined
  let more = Math.max(
    0,
    Math.min(
      bound,
      win?.total ??
        (page.eids.length == Math.max(size, limit) ? page.eids.length + 1 : 0),
    ) -
      page.eids.length,
  )
  let grow = () => {
    if (more && page.ready) setLimit(Math.max(size, limit) + size)
  }
  useEffect(() => {
    let node = root.current?.parentElement
    if (!node) return
    let scroll = () => {
      if (node.scrollHeight - node.scrollTop - node.clientHeight < 160) grow()
    }
    node.addEventListener('scroll', scroll)
    return () => node.removeEventListener('scroll', scroll)
  }, [more, size, limit, page.ready])
  let failed = boardRead?.state.status == 'failed' ? boardRead : undefined
  if (failed) {
    return (
      <ListFrame elRef={root}>
        <SubscriptionFailure read={failed} />
      </ListFrame>
    )
  }
  let rows: Ent[]
  let hot = false
  try {
    hot = orderOf(parseQuery(String(e.board?.query ?? ''))) == 'hot'
    rows = boardPost(e, false, page.eids).map(ent)
      .toSorted(hot ? byWarmth(Date.now()) : byModified)
  } catch {
    return <ListFrame elRef={root} /> // a bad query already shows itself on the Board face
  }
  // The member sub is a WINDOW now (live.ts boardLine), so `rows` is a page of
  // the board and not the board. "+N more" counts against the total the server
  // STATED, or the feed would say "+300 more" while four thousand match — the
  // silent truncation this row exists to prevent. The ephemeral filter is
  // part of this page's query, so the total follows it too.
  return (
    <ListFrame elRef={root}>
      {rows.map((t) => (
        // a feed row dragged onto a canvas spawns the entity as a card
        <Row
          key={t.eid}
          draggable
          onDragStart={(ev: DragEvent) => dragData(ev, t.eid, 'Full')}
        >
          <Entity eid={t.eid} view='List.Tile' />
        </Row>
      ))}
      {more > 0 && (
        <Row mod='more'>
          <ListFrame.Action onClick={grow}>+{more} more</ListFrame.Action>
        </Row>
      )}
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
