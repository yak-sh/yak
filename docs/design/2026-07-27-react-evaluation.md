# React over Preact

## Decision

Stay on Preact. React Compiler is production-ready and useful, but it does not
address Tasks' measured bottleneck: one graph patch crosses a graph-wide
reactive boundary, wakes every entity reader, and makes every mounted board scan
the cache again. That work remains broad even if React memoizes the JSX around
it.

Fix the store and list boundaries first:

1. make an entity patch publish to that entity's signal;
2. consume board subscription membership instead of re-querying the cache;
3. keep gesture state outside the graph and commit once;
4. window a board only when its initial mounted tree exceeds the frame budget.

Reconsider React only if the same interaction still misses its budget after
those changes and a production A/B implementation measures a meaningful win.

## Evidence from Tasks

The recent performance failures were application invalidation and algorithms,
not missing component memoization:

- `159faf4` indexed dependencies once instead of scanning every edge from every
  `ent()` call. A live-sized profile measured about a 93% reduction in `ent()`
  self-time.
- `86fca8f` kept camera persistence off the graph-wide cache signal. A
  controlled 12-board, 400-task canvas went from 14 long tasks and a 964 ms
  maximum to no long tasks, a 33 ms maximum, and 0.2 ms of script per pan event.
- `57d0bda` stopped canvas wheel gestures from repeatedly entering an O(graph)
  card-raise path.
- `7958853` bound a z-only update to one pin signal. A 3,000-task canvas with a
  mounted 6,006-row board changed one `style` attribute in 2 ms instead of
  spending about 650 ms repainting the graph.

The current scratch browser probe (`bin/perf`, 200 tasks and 40 cards) reports:

- canvas pan: 0.6 ms script per main-thread task, no long tasks;
- 204-tile board first render: 219 ms to first contentful paint, with 78 ms in
  script, 22 ms in layout, and 10 ms in paint;
- board scroll: 4.1 ms p95.

Preact is already comfortably inside the interaction budget when the update has
the right scope. The remaining scaling problem is the scope itself.

## What React Compiler would and would not do

React Compiler automatically memoizes component renders, values, functions, and
JSX. It is a good replacement for hand-maintained `memo`, `useMemo`, and
`useCallback` in a React application.

It cannot infer that `cache[eid]` is independent from every other key when the
component subscribes to one `cache` snapshot. A new cache object is a changed
dependency. `Entity` must call `ent(eid)` again, `Board` must call
`boardTasks(e)` again, and the board query still visits the graph. React's
external-store contract likewise re-renders a subscriber when its snapshot
identity changes. The useful unit of memoization has to exist in the store
before a compiler can preserve it.

The compiler also does not reduce initial work whose output is all needed. A
6,000-row board still creates and mounts 6,000 rows. That requires a smaller
result set, pagination, or viewport windowing, regardless of renderer.

React's own guidance makes the same architectural points: keep transient state
local, minimize prop changes, and profile granular interactions. Memoization
helps when a component receives stable inputs; it is not a substitute for stable
inputs.

## Cost of switching

Tasks currently serves TypeScript modules directly, transforms JSX with Sucrase,
hot-swaps the component module graph, and vendors about 27 KB of uncompressed
Preact, hooks, JSX runtime, and Signals browser code. React Compiler is a Babel
build transform that must run before other transforms. Adopting it would add a
build pipeline or a second server-side compiler and would reshape the custom
hot-swap path.

The source migration is not just an import alias:

- 28 component modules and 35 source modules import Preact or Preact Signals;
- signal reads currently subscribe components automatically;
- signals passed to DOM props update those props without a virtual-DOM render,
  which is the mechanism used by a z-only pin raise;
- event code deliberately uses Preact's native DOM event behavior;
- overlays call Preact's `render()` directly into body-mounted hosts.

React has a Signals adapter, but then Tasks would be paying for React while
rebuilding Preact's tight Signals integration through hooks or a compiler
transform. That is migration risk without evidence of a performance gain.

## Target architecture

The cache should own data without also being the only notification channel.

### Entity rows

Keep the canonical cache for snapshot, persistence, and non-reactive graph
operations. Add a stable signal per entity. `applyLocal()` patches the canonical
row and publishes only the touched row signals; creation and death also update a
small entity-id index.

`Entity eid=…` then depends on its row, not on the identity of the complete
cache. A task edit wakes that task's mounted faces. It does not wake cameras,
other cards, or unrelated boards.

### Derived relationships

Index relationships at their ownership boundary:

- dependencies by parent;
- pins by canvas;
- comments by target;
- backlinks by target where a mounted view needs them.

Update the affected index entries from the applied batch. Do not rescan the
graph from each renderer.

### Board membership

Finish the query-subscription migration already designed under T-3683. The
server maintains membership from touched entities; a board renders its
subscription's eid set. The client may apply an ephemeral filter to that bounded
set, but a normal patch should not make every board re-run its saved query over
every cached entity.

This is the general fix for T-7249. Per-entity signals prevent unrelated
rendering; incremental board membership prevents unrelated query work. Both are
needed.

### Interaction state

Camera movement, card drag, resize, and stacking establish the pattern:
gesture-frequency state uses a local signal or a compositor-friendly DOM
property, then one graph patch records the settled result. Keep extending that
rule to future high-frequency interactions.

### Large initial trees

After subscriptions and boot partitioning, measure a live-sized board again. If
first mount remains over budget, window the rows or page the query. Compiler
memoization cannot help the first render of nodes that have never existed.

## Decision gate

A React spike becomes worthwhile only after the framework-independent work is
complete. Compare production builds on the same live-sized database and CDP
trace:

- first meaningful render;
- one unrelated graph patch with several boards mounted;
- card raise, camera pan, board scroll, and task edit;
- main-thread p95, long-task count, script/layout/paint split, and bytes
  transferred.

Switch only if React plus Compiler wins materially after including its runtime
and build costs. Until then, changing frameworks would delay the fixes that both
implementations require.

## References

- [React Compiler introduction](https://react.dev/learn/react-compiler/introduction)
- [React Compiler installation](https://react.dev/learn/react-compiler/installation)
- [React Compiler incremental adoption](https://react.dev/learn/react-compiler/incremental-adoption)
- [React memo reference](https://react.dev/reference/react/memo)
- [React external store snapshots](https://react.dev/reference/react/useSyncExternalStore)
- [Preact Signals rendering optimizations](https://preactjs.com/guide/v10/signals/#rendering-optimizations)
- [Preact and React differences](https://preactjs.com/guide/v10/differences-to-react/)
