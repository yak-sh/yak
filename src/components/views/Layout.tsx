import { useState } from 'preact/hooks'
import { type Ent, type Hit, idOf, uuid } from '../../types.ts'
import { backlinks, ent, mutate } from '../../live.ts'
import { useBacklinks } from '../useQuery.ts'
import { block } from '../ui.tsx'
import { resolve } from '../registry.ts'
import { Entity } from '../Entity.tsx'
import { panEvents } from '../Canvas.tsx'
import { close, kids, resize, setContent, split } from '../../layout.ts'

// The tiling container (D-14718): a layout entity rendered as its pane
// tree. A container pane lays its children along dir, each flex-weighted
// by its own size (flex-grow normalizes the weights natively); a leaf
// renders its content through the shared registry; an empty leaf offers
// an inline finder — the palette's stand-in until rollout step 3. Every
// gesture is one layout.ts batch through mutate(); a gutter drag
// previews locally and lands its two-change batch on settle, the Canvas
// settle discipline.

let Frame = block('div', 'Layout', {
  Pane: 'div',
  Gutter: 'div',
  Acts: 'div',
  Act: 'button',
  Fill: 'div',
  Row: 'button',
  Empty: 'div',
})
let { Pane, Gutter: GutterEl, Acts, Act, Fill: FillEl, Row, Empty } = Frame

// The panes of one layout, straight off the reactive cache. The cache
// key is the identity (a comp cast from another client may carry no eid
// inside itself — the Pinned precedent), so eid is restamped here.
// Imperative on purpose — handlers call it mid-gesture — so the Layout
// component HOLDS the `.refs=<layout>` sub (useBacklinks at its root) and
// every read here reuses that held set; alone this would leak the sub.
let panesOf = (layout: string) =>
  backlinks(layout)
    .filter((b) => b.via == 'pane.layout')
    .flatMap((b) => {
      let p = ent(b.from).pane
      return p ? [{ ...p, eid: b.from }] : []
    })

// A gutter between two siblings: drag transfers weight. The preview
// writes flex-grow on the two neighboring elements only; the settle
// computes the final batch and pins the DOM to it, so a clamped or
// unmoved drag can never leave a preview value behind.
let Gutter = ({ dir, a, b }: { dir: string; a: string; b: string }) => {
  let down = (e: PointerEvent) => {
    let g = e.currentTarget as HTMLElement
    e.preventDefault()
    e.stopPropagation()
    g.setPointerCapture(e.pointerId)
    let horiz = dir == 'h'
    let span = horiz
      ? g.parentElement!.clientWidth
      : g.parentElement!.clientHeight
    let start = horiz ? e.clientX : e.clientY
    let pa = { ...ent(a).pane!, eid: a }
    let pb = { ...ent(b).pane!, eid: b }
    let sibs = kids(panesOf(pa.layout!), pa.parent!)
    let total = sibs.reduce((n, s) => n + (s.size ?? 1), 0) || 1
    let prev = g.previousElementSibling as HTMLElement
    let next = g.nextElementSibling as HTMLElement
    let dw = 0
    let move = (ev: PointerEvent) => {
      dw = ((horiz ? ev.clientX : ev.clientY) - start) / span * total
      prev.style.flexGrow = String(Math.max(0.05, (pa.size ?? 1) + dw))
      next.style.flexGrow = String(Math.max(0.05, (pb.size ?? 1) - dw))
    }
    panEvents(g, move, () => {
      let batch = resize([pa, pb], a, b, dw)
      prev.style.flexGrow = String(batch[0]?.comp?.size ?? pa.size ?? 1)
      next.style.flexGrow = String(batch[1]?.comp?.size ?? pb.size ?? 1)
      if (batch.length) mutate(...batch)
    })
  }
  return <GutterEl mod={dir} onPointerDown={down} />
}

// The thin pane chrome, shown on hover: split right, split below, close.
let PaneActs = ({ eid, layout }: { eid: string; layout: string }) => {
  let act = (
    run: (panes: ReturnType<typeof panesOf>) => ReturnType<typeof split>,
  ) =>
  (e: MouseEvent) => {
    e.stopPropagation()
    mutate(...run(panesOf(layout)))
  }
  return (
    <Acts>
      <Act
        data-tip='split right'
        onClick={act((panes) => split(panes, eid, 'h'))}
      >
        │
      </Act>
      <Act
        data-tip='split below'
        onClick={act((panes) => split(panes, eid, 'v'))}
      >
        ─
      </Act>
      <Act data-tip='close pane' onClick={act((panes) => close(panes, eid))}>
        ×
      </Act>
    </Acts>
  )
}

// The inline finder an empty pane offers: type, pick, the pane fills —
// the pick stores the target's default view, spawnHit's convention.
let Fill = ({ eid, layout }: { eid: string; layout: string }) => {
  let [hits, setHits] = useState<Hit[]>([])
  let seek = async (q: string) => {
    let found: Hit[] = []
    if (q.trim()) {
      let r = await fetch(`/search?q=${encodeURIComponent(q)}`)
      if (r.ok) found = await r.json()
    }
    setHits(found)
  }
  let pick = (h: Hit) =>
    mutate(...setContent(
      panesOf(layout),
      eid,
      h.open,
      resolve(ent(h.open)).view,
    ))
  return (
    <FillEl>
      <input
        placeholder='fill this pane — search the graph…'
        onInput={(e: InputEvent) =>
          seek((e.currentTarget as HTMLInputElement).value)}
      />
      {hits.slice(0, 12).map((h) => (
        <Row key={h.eid} onClick={() => pick(h)}>
          {h.title || '(untitled)'} <span>{idOf(h)}</span>
        </Row>
      ))}
    </FillEl>
  )
}

// One pane, recursive. Weight rides inline (data); the axis is a class.
let PaneView = ({ eid, layout }: { eid: string; layout: string }) => {
  let p = ent(eid).pane
  if (!p) return null
  let ks = p.dir ? kids(panesOf(layout), eid) : []
  return (
    <Pane
      mod={p.dir ? (p.dir == 'h' ? 'row' : 'col') : 'leaf'}
      data-eid={eid}
      style={{ flexGrow: p.size ?? 1 }}
    >
      {p.dir
        ? ks.flatMap((k, i) => [
          ...(i
            ? [
              <Gutter
                key={`g${k.eid}`}
                dir={p.dir!}
                a={ks[i - 1].eid}
                b={k.eid}
              />,
            ]
            : []),
          <PaneView key={k.eid} eid={k.eid} layout={layout} />,
        ])
        : p.content
        ? <Entity eid={p.content} view={p.view || undefined} />
        : <Fill eid={eid} layout={layout} />}
      {!p.dir && <PaneActs eid={eid} layout={layout} />}
    </Pane>
  )
}

export let Layout = ({ e }: { e: Ent }) => {
  // Hold the layout's reverse sub for the view's life: panesOf's imperative
  // reads (render helpers AND drag/close handlers) reuse this held set, and
  // closing the layout releases it (T-21489).
  useBacklinks(e.eid)
  let root = e.layout?.root
  if (root && ent(root).pane) {
    return (
      <Frame>
        <PaneView eid={root} layout={e.eid} />
      </Frame>
    )
  }
  // A rootless layout (its root pane was deleted directly — root
  // detaches by design): offer to re-root rather than render a dead end.
  let reroot = () => {
    let pane = uuid()
    mutate(
      { eid: pane, name: 'pane', comp: { layout: e.eid } },
      { eid: e.eid, name: 'layout', comp: { root: pane } },
    )
  }
  return (
    <Frame>
      <Empty>
        empty layout —{' '}
        <button type='button' onClick={reroot}>add a pane</button>
      </Empty>
    </Frame>
  )
}
