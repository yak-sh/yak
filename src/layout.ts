// Tiling layout gestures (D-14718), pure: each op reads the panes the
// caller already has and returns ONE flat Change[] — apply() runs it
// atomically, so a multi-pane edit never tears. No door talks to a cache
// or a socket here; the web view and the future TUI share this seam.
// Within a batch, reparents come BEFORE deletes: the reaper's doom-walk
// reads current rows, so a child moved first escapes its old parent's
// cascade.
import { type Change, type Pane, uuid } from './types.ts'

export type Dir = 'h' | 'v'

let by = (panes: Pane[], eid: string) => panes.find((p) => p.eid == eid)

// Siblings in paint order. The eid tiebreak keeps two panes minted with
// one order value stable across renders.
/// kids([{eid: 'b', parent_eid: 'r', order: 1},
///       {eid: 'a', parent_eid: 'r', order: 0}], 'r').map(p => p.eid)
///   -> ['a', 'b']
export let kids = (panes: Pane[], parent: string) =>
  panes.filter((p) => p.parent_eid == parent)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.eid < b.eid ? -1 : 1))

let mint = (eid: string, comp: Record<string, unknown>): Change => ({
  eid,
  name: 'pane',
  comp,
})

// Split a pane. Along the surrounding dir it is ONE change — a new empty
// sibling at the pane's own weight, ordered between it and the next
// (weights renormalize at render, so nothing else moves). Across, the
// pane BECOMES the container: its content (or its old-dir children,
// hoisted under a new intermediate) moves down, an empty pane joins as
// the second child. The new pane is empty on purpose — it renders the
// palette.
export let split = (panes: Pane[], eid: string, dir: Dir): Change[] => {
  let p = by(panes, eid)
  if (!p) return []
  let parent = p.parent_eid ? by(panes, p.parent_eid) : undefined
  if (parent?.dir == dir) {
    let sibs = kids(panes, parent.eid)
    let next = sibs[sibs.findIndex((s) => s.eid == eid) + 1]
    let order = next
      ? ((p.order ?? 0) + (next.order ?? 0)) / 2
      : (p.order ?? 0) + 1
    return [mint(uuid(), {
      layout_eid: p.layout_eid,
      parent_eid: parent.eid,
      size: p.size ?? 1,
      order,
    })]
  }
  if (p.dir == dir) {
    // A container split along its own axis: one more child at the end.
    let last = kids(panes, eid).at(-1)
    return [mint(uuid(), {
      layout_eid: p.layout_eid,
      parent_eid: eid,
      size: last?.size ?? 1,
      order: (last?.order ?? 0) + 1,
    })]
  }
  let held = p.dir ? kids(panes, eid) : []
  let a = uuid()
  return [
    { eid, name: 'pane', comp: { dir, content_eid: null, view: null } },
    ...held.map((k) => mint(k.eid, { parent_eid: a })),
    mint(a, {
      layout_eid: p.layout_eid,
      parent_eid: eid,
      size: 1,
      order: 0,
      ...(p.dir
        ? { dir: p.dir }
        : { content_eid: p.content_eid ?? null, view: p.view ?? null }),
    }),
    mint(uuid(), {
      layout_eid: p.layout_eid,
      parent_eid: eid,
      size: 1,
      order: 1,
    }),
  ]
}

// Close a pane: delete its entity — descendants cascade server-side, and
// the siblings' weights renormalize at render with no splice. When the
// parent goes unary the survivor hoists into it (content up, or dir +
// children up) and is deleted, so no container ever holds one child. The
// root never deletes — a layout always has a pane — it clears to empty.
export let close = (panes: Pane[], eid: string): Change[] => {
  let p = by(panes, eid)
  if (!p) return []
  if (!p.parent_eid) {
    return [
      ...kids(panes, eid).map((k) =>
        ({ eid: k.eid, name: 'entity', comp: null }) as Change
      ),
      { eid, name: 'pane', comp: { dir: null, content_eid: null, view: null } },
    ]
  }
  let del: Change = { eid, name: 'entity', comp: null }
  let sibs = kids(panes, p.parent_eid).filter((s) => s.eid != eid)
  if (sibs.length != 1) return [del]
  let s = sibs[0]
  let parent = p.parent_eid
  return [
    del,
    ...(s.dir
      ? [
        ...kids(panes, s.eid).map((k) => mint(k.eid, { parent_eid: parent })),
        mint(parent, { dir: s.dir }),
      ]
      : [
        mint(parent, {
          dir: null,
          content_eid: s.content_eid ?? null,
          view: s.view ?? null,
        }),
      ]),
    { eid: s.eid, name: 'entity', comp: null },
  ]
}

// The smallest weight a drag can leave — a pane never resizes to nothing
// (close is the gesture for that).
let MIN = 0.05

// Transfer weight between two adjacent siblings: a grows by delta, b
// shrinks. Delta is in WEIGHT units — the caller converts pixels against
// the siblings' total. One batch on settle, never per pixel.
/// resize([{eid: 'a', parent_eid: 'r', size: 1},
///         {eid: 'b', parent_eid: 'r', size: 1}], 'a', 'b', 0.5)
///   -> [{eid: 'a', name: 'pane', comp: {size: 1.5}},
///       {eid: 'b', name: 'pane', comp: {size: 0.5}}]
export let resize = (
  panes: Pane[],
  a: string,
  b: string,
  delta: number,
): Change[] => {
  let pa = by(panes, a)
  let pb = by(panes, b)
  if (!pa || !pb || pa.parent_eid != pb.parent_eid) return []
  let wa = pa.size ?? 1
  let wb = pb.size ?? 1
  let d = Math.max(Math.min(delta, wb - MIN), MIN - wa)
  if (!d) return []
  // Rounded so a drag stores tidy weights, and a clamped edge lands ON
  // the floor instead of a float hair above it.
  let r4 = (n: number) => Math.round(n * 1e4) / 1e4
  return [
    mint(a, { size: r4(wa + d) }),
    mint(b, { size: r4(wb - d) }),
  ]
}

// Fill a leaf: what it shows and how. null clears back to empty.
export let setContent = (
  panes: Pane[],
  eid: string,
  target: string | null,
  view?: string | null,
): Change[] =>
  by(panes, eid) ? [mint(eid, { content_eid: target, view: view ?? null })] : []

// Exchange two leaves' content — the panes keep their place and size.
export let swap = (panes: Pane[], a: string, b: string): Change[] => {
  let pa = by(panes, a)
  let pb = by(panes, b)
  if (!pa || !pb) return []
  return [
    mint(a, { content_eid: pb.content_eid ?? null, view: pb.view ?? null }),
    mint(b, { content_eid: pa.content_eid ?? null, view: pa.view ?? null }),
  ]
}

// A fresh layout in one batch: doc + layout + root. One leaf (or none)
// IS the root; more make the root an h-container with equal children.
export let mintLayout = (
  title: string,
  leaves: { content_eid?: string | null; view?: string | null }[] = [],
): { eid: string; changes: Change[] } => {
  let eid = uuid()
  let root = uuid()
  let changes: Change[] = [
    { eid, name: 'doc', comp: { title, body: '' } },
    { eid, name: 'layout', comp: { root_eid: root } },
    ...(leaves.length < 2
      ? [mint(root, { layout_eid: eid, ...(leaves[0] ?? {}) })]
      : [
        mint(root, { layout_eid: eid, dir: 'h' }),
        ...leaves.map((leaf, i) =>
          mint(uuid(), {
            layout_eid: eid,
            parent_eid: root,
            size: 1,
            order: i,
            ...leaf,
          })
        ),
      ]),
  ]
  return { eid, changes }
}

// Deliberately absent: fork (the shared-layout copy is data the model
// already supports — the gesture lands with the palette phase, D-14718
// rollout 3) and any tree normalizer — every op above leaves the tree
// well-formed, so no renderer defends against a malformed one.
