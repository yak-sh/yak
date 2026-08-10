import { type JSX } from 'preact'
import { type Ent } from '../types.ts'

// The renderer registry MACHINERY — no view imports, so anything (a view
// module, the TUI, a future plugin) can import matchers and types from
// here without a cycle. The curated list itself lives in Entity.tsx, which
// calls define() once at module scope.
//
// The vocabulary: a VIEW is a string — a named way of looking at an
// entity ('Full', 'Debug', 'Inline', …). It's what a card stores and what a
// tab picks. A RENDERER is a component registered for one view + an
// entity matcher. There is no kind — an entity is what its components
// make it, and the most SPECIFIC renderer wins: match returns a score
// (has('doc','task') scores 2, so Task beats the plain Doc renderer's 1
// on task entities); booleans still work as the weakest tier (true =
// 0.5, the catch-alls). Ties go to registration order. Proper queries
// come later; this is the simple thing that works.
//
// A renderer may also carry a FILE form: how this view of this entity
// serializes when its tab is dragged to the desktop. A card-framed look
// is not a variant field — it's a registration under a Card.* name
// (Card.Full, Card.Title): the frame asks with the qualifier and the
// walk falls to the plain role when no card face exists.
// null is a first-class render: a section view with nothing to say
// renders nothing (the Full stack relies on it).
export type Render = (
  p: { e: Ent; [x: string]: unknown },
) => JSX.Element | null
export type Renderer = {
  view: string
  match: (e: Ent) => number | boolean
  Render: Render
  file?: { ext: string; mime: string; text: (e: Ent) => string }
}

// The standard matcher: all named components present → their count.
export let has = (...names: (keyof Ent & string)[]) => (e: Ent) =>
  names.every((n) => !!e[n]) ? names.length : 0

// Score a match: the count of components it claimed, 0.5 for a bare true.
let score = (r: Renderer, e: Ent) => {
  let m = r.match(e)
  return m === true ? 0.5 : Number(m)
}

// The shared list and the tab order — set once by Entity.tsx.
let registry: Renderer[] = []
let tabs: string[] = []
export let define = (rs: Renderer[], tabViews: string[]) => {
  registry = rs
  tabs = tabViews
}

// ACTIONS — the context-menu verbs, contributed the same way renderers
// are but with UNION semantics: a task is also a doc is also an entity,
// so every matching contributor's verbs appear (in registration order),
// not just the most specific one's. `mod` styles a row ('danger').
export type Action = { label: string; run: () => void; mod?: string }
export type Contributor = {
  match: (e: Ent) => number | boolean
  acts: (e: Ent) => Action[]
}
let contributors: Contributor[] = []
export let defineActions = (cs: Contributor[]) => {
  contributors = cs
}
export let actionsFor = (e: Ent) =>
  contributors.filter((c) => c.match(e)).flatMap((c) => c.acts(e))

// Platform overlays: another render target (the TUI) — or one day a
// plugin — prepends its own renderers at boot: same views, same
// contract, consulted before the shared registry, so a tie in score goes
// to the override. Still curated: called from entry points, never at
// runtime.
let overrides: Renderer[] = []
export let extend = (rs: Renderer[]) => {
  overrides = [...rs, ...overrides]
}
let all = () => (overrides.length ? [...overrides, ...registry] : registry)

// The views that may appear as card tabs, in tab order. A view tabs for
// an entity iff some renderer serves it; Debug's catch-all means every
// card gets a Debug tab. Views not listed (Inline, Dependency, the raw file
// forms) are internal — reachable only by explicit name.
export let applicable = (e: Ent) =>
  tabs.filter((v) => all().some((r) => r.view == v && score(r, e) > 0))

// The renderer serving a view of an entity: the highest-scoring match in
// the pool (the named view's renderers, or every tab view for the
// default look), earliest registration breaking ties. An unservable ask
// falls back to the JSON catch-all.
let best = (e: Ent, pool: Renderer[]) => {
  let top: Renderer | undefined
  let max = 0
  for (let r of pool) {
    let s = score(r, e)
    if (s > max) {
      max = s
      top = r
    }
  }
  return top
}

let json = () => registry.find((r) => r.view == 'JSON')!

// Old stored view names → current, consulted at every walk level.
// card.view is live data and old ?v= URLs linger, so a renamed view must
// keep resolving instead of falling to JSON — and the frame prefixes its
// ask (Card.Show), so the heal must apply after a strip too.
export let alias: Record<string, string> = {
  'Show': 'Full',
  'Id': 'Inline',
  'List.Item': 'List.Tile',
  'Task.Row': 'Board.List.Tile',
  'Debug.ListItem': 'Debug.Tile',
}

// A dotted view name is container qualifiers left, ROLE rightmost
// (Board.List.Tile). The walk tries the full name, then strips the
// leftmost qualifier until some renderer matches (List.Tile, then Tile)
// — place beats shape — with component scores breaking ties within a
// level as usual. A short registration serves every longer ask; a long
// one specializes one surround.
export let resolve = (e: Ent, view?: string): Renderer => {
  if (!view) {
    return best(e, all().filter((r) => tabs.includes(r.view))) ?? json()
  }
  for (let v = view; v; v = v.replace(/^[^.]+\.?/, '')) {
    v = alias[v] ?? v
    let r = best(e, all().filter((x) => x.view == v))
    if (r) return r
  }
  return json()
}
