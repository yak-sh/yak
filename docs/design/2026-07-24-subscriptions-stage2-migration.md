# Query subscriptions, stage 2 — the fleet-client migration

The client-side migration onto subscriptions: boards then boot move off the
full-cache scan and the full `/snapshot`, making the client cache **partial**.
Stage 1 (`71d8ecf`) shipped the mechanism (sub/unsub frames, server
`maintain()`, client `subMembers`+evict) but nothing in the client subscribes
yet — boards still scan, boot still fetches the whole snapshot, the cache is
still complete.

**Sequencing note (2026-07-24):** the owner re-ordered the epics to build the
IndexedDB+delta client (T-6829) BEFORE this migration, because that preserves
the complete-cache invariant and delivers the boot-cost win without going
partial. This doc is the recorded plan for stage 2 whenever it runs; it is not
yet in build. Line numbers verified against the tree at authoring; the older
design doc's `241-279` for the board readers had drifted to `live.ts:301-339`.

## The finding that dominates everything: subscriptions ship components, not edges

`spread()` (`subs.ts:40-48`) and `eager()` (`db.ts:1456-1470`) emit ONLY
component rows — no `dependency` edges (the subs.ts comment says so: "edges
don't ride here (stage 1 subs are own-comp, deps join in stage 2)"). Today
`boot()` fills `deps` from `snap.deps` (`live.ts:245`); a live edit's edge rides
as a `dependency` Change through `applyLocal` (`live.ts:104-118`). But the
**initial subscription set carries no edges**, and no path exists for an edge
whose endpoints straddle the subscribed set.

Under a partial cache this breaks everything edge-derived: `ent().refs/kids`
(`live.ts:279-284`), `byParent` (`live.ts:257-265`), `gated` (`live.ts:85-89`),
`parents` (`live.ts:433`), the `Dependency` view, `Relate`'s `taken` set,
`Persona` tiers. **Edge delivery is the hard gate on the partial-cache flip (2c)
and the largest new server work in the stage.**

## A. The complete-cache-assumption audit

"Bounded" = the _result_ is a small standing set a shape subscription can hold;
"Unbounded" = grows with the graph. A bounded _result_ can still need unbounded
_input_ present to compute it (noted).

### A.1 — `live.ts` exported readers

| #  | Site                    | Computes                                           | Bnd?       | Breaks under partial cache                                                  | Remedy                                                             |
| -- | ----------------------- | -------------------------------------------------- | ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1  | `boardTasks` `:301`     | tasks matching `board.query`                       | Unb        | scans whole cache → wrong set                                               | subscribe `board.query`, read `subMembers` (2a/2b)                 |
| 2  | `boardAll` `:318`       | whole-graph feed matching query, minus CHROME/self | Unb        | same                                                                        | subscribe query; keep CHROME/self post-filter over `subMembers`    |
| 3  | `sieve`/`passOf` `:335` | ephemeral filter pred                              | Bnd        | composes over shown set — OK; derefs for path preds                         | keep (design §4); off-cache id → no-match                          |
| 4  | `rows()` `:344`         | whole cache as `Row[]`                             | Unb        | command `Ctx`, Admin, pickers, Persona, Md see a partial graph              | split per caller; command `Ctx` needs server-side id resolution    |
| 5  | `domains` `:355`        | distinct `task.domain`                             | Bnd/Unb-in | needs all tasks                                                             | task shape sub, or server `distinct`                               |
| 6  | `projects()` `:363`     | all projects                                       | Bnd        | no live caller — **dead export**                                            | `shape:project` or delete                                          |
| 7  | `commentsOn` `:371`     | comments targeting eid                             | Bnd/Unb-in | needs all comments                                                          | subscribe `.comment.target_eid=<eid>` when on screen               |
| 8  | `commentCount` `:379`   | tally per target                                   | Bnd/Unb-in | board comment badges undercount silently                                    | comment subs for visible targets, or server count in board payload |
| 9  | `rootCanvas` `:391`     | first canvas by num                                | Bnd        | `/` route depends on it                                                     | `shape:canvas` or server "root" pointer                            |
| 10 | `pinned` `:399`         | cards pinned to a canvas                           | Bnd/Unb-in | needs all cards+pins **and each card's target cached**                      | per-canvas working-set sub (pins+cards+targets)                    |
| 11 | `backlinks` `:415`      | who points here (any eid-prop)                     | Unb        | whole-cache OR-over-props scan                                              | server `refs:<eid>` sub                                            |
| 12 | `parents` `:433`        | deps where child==eid                              | —          | needs upward edges                                                          | edge-delivery gate (2c)                                            |
| 13 | `boardsOver` `:439`     | boards whose query contains eid                    | Bnd/Unb-in | needs all boards                                                            | `shape:board`                                                      |
| 14 | `topZ` `:445`           | max z of a canvas's pins                           | Bnd        | needs canvas pins                                                           | canvas sub                                                         |
| 15 | `toFront` `:455`        | one pin + `topZ`                                   | Bnd        | fine once pins present                                                      | canvas sub                                                         |
| 16 | `myCamera` `:472`       | this client's camera                               | Bnd        | needs cameras                                                               | client/chrome shape sub                                            |
| 17 | `findEid` `:295`        | whole-cache num/slug→eid                           | Unb        | off-set id won't resolve; used by `Val.tsx`, board scans                    | scan use dies with 2b; `Val`/route → server `.num=`                |
| 18 | `warmth` `:65`          | hot score; derefs project                          | Bnd-deref  | uncached project → blank sink → mis-rank                                    | shape sub includes projects, or accept degraded hot                |
| 19 | `gated` `:85`           | red dot: any open `requires` child                 | —          | needs edge + child status                                                   | edge-delivery + depth-1 neighbor comps (2c)                        |
| 20 | `evict` `:214`          | drops eids in no sub                               | —          | (new) must also prune `deps` incident to evicted eids or `byParent` dangles | extend `evict` to prune deps                                       |

### A.2 — `src/components/` scans

| Site                                           | Computes                                     | Bnd?       | Remedy                                                              |
| ---------------------------------------------- | -------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| `nav.tsx:101` `screenTarget`                   | `/T-123`→eid by num                          | Unb        | route subscribes target; server `.num=`                             |
| `nav.tsx:69` data-ref click                    | md `T-123`→eid                               | Unb        | route/peek sub on click; else honest href degrade                   |
| `Admin.tsx:111,348`                            | all of a kind; per-kind counts               | Unb        | Admin subscribes per-kind on mount (legit unbounded view)           |
| `Admin.tsx:222`,`editors.tsx:241` `candidates` | picker options (all carriers of comp X)      | Unb        | per-picker sub of the comp, or server search                        |
| `Canvas.tsx:214`,`Status.tsx:190`              | person census                                | Bnd/Unb-in | `shape:person`                                                      |
| `Tray.tsx:56` `live()`                         | active+recent sessions                       | Unb        | standing sub `.session.status=<active>` + recent-managed            |
| `Tray.tsx:70`,`Board.tsx:134`                  | this client's shelf/fold                     | Bnd        | `shape:client` (folds/shelves/cameras)                              |
| `Persona.tsx:44` `loose`                       | all in-scope memories                        | Unb        | subscribe memories in `persona.home_eid` scope when open            |
| `Md.tsx:14` `asRows`→materialize               | persona file needs whole graph + tier bodies | Unb        | subscribe persona edge targets w/ bodies, or serve file server-side |
| `Relate.tsx:56`                                | all tasks title-search picker                | Unb        | hit server `/search` like `Search.tsx`                              |
| `Comments.tsx:89+`                             | `commentsOn` + author derefs                 | —          | comment sub includes authors, else byline→id                        |
| `Show.tsx`                                     | count/backlinks/parents/boardsOver           | mixed      | see A.1 #8,11,12,13                                                 |
| `App.tsx:43 Crumbs`,`nav.tsx:118`              | trail filtered by cache presence             | Bnd        | evicted crumb vanishes — acceptable, or light-sub trail targets     |

### A.3 — `src/tui/` (a client too, smaller surface)

The TUI boots through the same `boot()` (`tui/main.tsx:49`) and renders from the
same cache. Working set = `{boards}` shape + browsed board's task sub + comment
sub for the selected/entered entity + edges for the entered entity.

| Site                                   | Computes                | Remedy                                                    |
| -------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `tui/App.tsx:39` `boardEid`            | first board by num      | `shape:board`                                             |
| `tui/App.tsx:45` `rows`(=`boardTasks`) | browsed board           | board sub (shared code, converts free)                    |
| `tui/App.tsx:203` `commentsOn`         | entered task's comments | comment sub                                               |
| `tui/App.tsx:222` `ctx().rows`         | command context         | server-side id resolution (shared w/ web `Status.tsx:69`) |

`paint.ts` references `pinned`/`rows` but never paints a Canvas (only Board/Full
overrides) — no canvas working-set sub needed there.

## B. Prove-before-flip migration plan

Guiding rule: no door retires until its replacement is proven end-to-end; the
cache never goes partial while any unconverted complete-cache reader exists.
Reuse stage-1 `subMembers`/`subscribe`/`evict`; one grammar (`query.ts`).

### 2a — boards subscribe in parallel, assert agreement (zero user-visible change)

- `Board.tsx` + `tui/App.tsx` `subscribe('board:'+eid, board.query)` on mount,
  `unsubscribe` on unmount; **the scan stays the render source.** Add a dev-only
  `subEids(id)` reader + `assertAgree(id, scanEids)` logging the symmetric
  diff + query on divergence.
- Scope the hard assertion to what `maintain()` supports (own-comp equality
  only, `server.ts:163-198`): path-pred and `.order=hot`/time boards are
  EXPECTED to diverge until the stage-2 path-target index lands — classify the
  query, assert hard on own-comp-eq, downgrade path/time to an annotated notice.
- Evidence before trust: (1) a probe matrix over each pred class (eq, list,
  range, `!=`, `~=`, CHROME/self post-filters) mutating tasks in/out; (2) a
  fleet window with the divergence counter at zero for own-comp-eq boards.
- Old door kept: scan, `/snapshot`, full cache — unchanged.

### 2b — flip boards to read `subMembers`

- `boardTasks`/`boardAll` return `[...subMembers.get('board:'+eid)].map(ent)`;
  delete the scan. `boardAll` keeps CHROME/self post-filter over the subscribed
  set. `sieve` still ANDs over the returned Ents.
- Side-effect check: scans were pure reads; ref sugar now resolves server-side
  in `evalQuery`. Confirm `Val.tsx` (client `findEid`) and `sieve` still
  resolve; an off-set id in a live filter degrades to no-match (acceptable).
- Low risk: cache still complete (boot unchanged), so `ent()` resolves
  neighbors, sorts and `warmth` project deref still work.
- Old door kept: `/snapshot` + full cache + legacy rebroadcast.

### 2c — boot conversion (the partial-cache flip; riskiest)

Gate: every Unbounded reader converted, every Bounded reader covered by a shape
sub, and the edge-delivery gap closed.

**2c-pre (server, behind the still-unused partial boot):**

1. **Edges in subscriptions (the gate).** Extend the initial set + `maintain()`
   to emit `dependency` Changes for every edge incident to a member (either
   endpoint) + the depth-1 neighbor entities' LIGHT comps (task status/priority,
   doc.title — no bodies). Gives `gated` the child status, `Dependency`/`Relate`
   the child title, `parents` the upward edges.
2. **`refs:<eid>` sub** for `backlinks`/`Debug`: server evaluates the eid-prop
   union (the `eidProps` list, computable from `vocab`+`stamped`) and pushes
   pointers-at-`<eid>` — the AND grammar can't express OR-over-props.
3. **`canvas=<eid>` working-set sub:** server expands a canvas → pins + cards +
   each card's `target_eid` (light comps), one sub id.
4. **Grammar:** a "has component" predicate (today `.canvas=` means _absent_)
   for shape subs; confirm `.num=` resolves a fullscreen route. Extend
   `query.ts` once; every door inherits it.
5. **`evict` prunes deps** incident to any evicted eid.
6. **Bodyless projection** on `eager()`/`spread()` mirroring
   `snapshot({bodies})`.

**Standing shape subscriptions** (replacing design §6's `q:""`=everything):
bounded comp-presence subs opened at boot — `shape:canvas`, `shape:board`,
`shape:project`, `shape:person`, `shape:client` (+camera/fold/shelf), and
`shape:sessions` = `.session.status=<active>` + recent-managed. Chrome/structure
entities number dozens–hundreds vs the tasks/docs/comments/logs the migration
sheds.

- **Root `/`:** `screenTarget` reads `rootCanvas` (from `shape:canvas`), then
  the `canvas=<root>` sub brings pins+cards+targets; `warmth` project deref
  covered by `shape:project`.
- **Fullscreen `/T-123`:** navigation subscribes `route:<id>` = server resolves
  `.num=123` → full comps incl. body + incident edges + depth-1 neighbors +
  `.comment.target_eid=<eid>`.
- **Card open/close:** a mounted `Card` subscribes `card:<target_eid>` (full
  comps
  - body + comments), unsubscribes on unmount; `subMembers` refcounting lets a
    card and route share an eid. **Subsumes T-6788** (body arrives with the card
    sub).

Then flip `boot()` (`live.ts:243-248`): socket first, send the root working-set
subs, drop `fetch('/snapshot')` for init. Initial frames are the snapshot;
deltas arrive on the same ordered socket — the race gone structurally. Convert
incidental readers in the same rung (Admin→per-kind, Tray→session sub,
Persona→scoped-memory, candidates/Relate→server search, Comments→comment sub,
backlinks→`refs:<eid>`).

- Old door kept: `/snapshot` for the CLI/headless (`client.ts:36`) + reconnect
  HEAD probe (`live.ts:165`); legacy full-rebroadcast for any never-subscribing
  socket. Verify end-to-end on a PARTIAL cache (web + TUI); assert
  `Object.keys(cache.value).length` « total graph.

### 2d — `doc.body` lazy

Only after boot is subscription-driven. Shape/board/canvas subs use the bodyless
projection; `card:`/`route:` subs carry bodies. The data-loss guard carries
verbatim: any body-rendering-or-editing view must have the body in cache before
it is interactive.

- Editor arms today at `Edit.tsx:49-59` (`begin()` when `open`); commit at
  `:83`. With a bodyless doc, `doc.body===undefined` = unloaded (vs `===''`
  empty).
- Gate: `Edit` must NOT `begin()` when
  `comp==='doc' && prop==='body' &&
  value===undefined` — read-only placeholder
  until the body lands. Render triggers (`Show.Body`, `Md.tsx`,
  `tui/App.tsx:195`, `Comments`) show a placeholder on
  `doc && body===undefined`; the card/route sub is fetching it.
- Bar test: open an unloaded doc, dbl-click body, type, blur → the stored body
  is UNCHANGED until the real body loaded (no clobber).

## Build order

| Rung   | Lands                                                                                                                  | Old door held                            | Verify                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| 2a     | parallel `board:` sub + dev agreement assertion                                                                        | scan is render source; `/snapshot`+cache | divergence counter 0 (own-comp-eq) across probe matrix + fleet window        |
| 2b     | `boardTasks`/`boardAll` read `subMembers`; scan deleted                                                                | `/snapshot`+cache+legacy                 | boards render identical; TUI board unchanged                                 |
| 2c-pre | server: edges+neighbors, `refs:<eid>`, `canvas=<eid>`, has-comp/`.num` grammar, evict prunes deps, bodyless projection | partial boot unused                      | probe subscribes a working set; edges+neighbors arrive; eviction prunes deps |
| 2c     | convert unbounded readers; open shape subs; flip `boot()` socket-first, drop `/snapshot` init                          | `/snapshot` for CLI+reconnect; legacy    | full end-to-end on partial cache (web+TUI); cache « total graph              |
| 2d     | shape/board subs bodyless; `Edit` body gate + placeholders                                                             | card/route subs carry bodies             | no-clobber bar test; boot payload halves                                     |

## Open questions for the owner (surface when stage 2 starts)

1. **Edge/neighbor closure:** depth-1 confirmed; neighbors ship LIGHT comps
   (status/priority/title — recommended) or full?
2. **Grammar:** does `query.ts` already express "has component X" (`.canvas=` =
   absent today) and `.num=` route resolution? One addition serves shape subs +
   routing.
3. **backlinks:** dedicated server `refs:<eid>` sub (recommended) vs OR grammar
   in `query.ts`?
4. **Canvas working set:** server `canvas=<eid>` expansion (recommended) vs
   client two-phase pins→targets?
5. **Aggregates (`commentCount`, `domains`):** recompute over the partial set
   (undercount) vs a server aggregate in the board payload?
6. **Pickers (`candidates`, `Relate`):** move to server `/search` (recommended)
   vs shape-subscribe all tasks?
7. **Path/time-pred boards** diverge in the 2a assertion by design — confirm we
   gate the hard assertion to own-comp-eq boards, path/time correctness
   follow-on.
8. **Persona materialization** needs the tiered-doc set WITH bodies — subscribe
   persona edge targets w/ bodies, or serve the persona file server-side
   (`persona.ts` already materializes; expose like `/body`)?
