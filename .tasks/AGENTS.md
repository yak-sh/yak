<!-- GENERATED from N-4053 (tasks-v2 baseline) — edit in the graph (http://127.0.0.1:5173/N-4053, memory_save), never here: the
next sync overwrites hand edits. -->

The tasks-v2 working voice: one graph, many doors — every change is an entity patch, every list a query. Work in your own worktree, land with ff-only, gate with check+test, verify end-to-end before done. This persona carries what the fleet has learned; the repo specifics follow.

# Working in this repo

Tasks v2: the holdco fleet's entity graph — one SQLite file, a web canvas, a
TUI, a CLI, and an MCP server, all speaking the same wire. This file is for any
agent working here without prior context. README.md explains the product; this
explains how to change it safely.


## The one idea

Everything is an **entity** (a uuid + a server-minted number) that carries
**components** (one row per component table, same eid). There is no `kind`
column — an entity _is_ what its components make it:

- a **task** is `doc` (title/body) + `task` (status/priority/project)
- a **board** is `doc` + `board(query)` — a saved filter over tasks; a
  **project** is `doc` + `project`
- a **comment** is `doc` + `comment(target_eid)` — aimed at ANY entity
- a **claim** is a session's lease on any entity; a **session** is an agent

`kindOf()` derives a display name; renderers never check it — they pattern-
match on components, most specific match wins (see Rendering).

## The vocabulary is one list

`src/types.ts` `comps` maps component → wire-writable columns **and what each
one IS** (`PropType`: text/body/number/bool, `{enum}`, `{eid}`, `{text: well}`).
From that one list flow, with **zero further edits**:

- the db sync allowlist and entity-delete order (db.ts `cmps`, from the keys)
- CLI/MCP dot-param routing (`.title=x` → doc because only doc has title)
- the MCP tools' self-documentation (GRAMMAR is generated, enums spell their
  values)
- the browser/TUI cache shape (live.ts `Comps` derives from `Ent`)
- prop editors auto-pick their control from the type (the editor registry)

**To add a component**: add it to `comps`, its type + `Ent` field, and (if it
should name entities) `kindOrder`, all in types.ts; add the table in db.ts
`schema`. Done — cache, Debug view, JSON, CLI filters, and MCP pick it up.
Columns that only the server may write (timestamps, ip) stay OUT of `comps` and
get stamped in server code (see `frozen_at`, `claimed_at`, `ip`).

## The wire

A `Change` is `{eid, name, comp}` — a PATCH: omitted columns untouched,
`prop: null` clears a column, `comp: null` deletes the component,
`{name:'entity', comp:null}` deletes the entity (tombstoned — nothing can
resurrect the eid). A batch is a flat array; db.ts `apply()` runs it atomically.
Clients mint eids (uuid v4); the spine + num appear on first touch. Browser tabs
sync over `/ws`; headless clients POST `/apply`; both broadcast to everyone
else. Special apply RULES (the claim lease check, the stop_request gate) live in
`apply()` — in-transaction, able to reject the batch — and hold for every entry
path. EFFECTS are the other half (src/effects.ts): post-commit observers,
registered in server.ts, that DO things about committed data — a session created
with a provider spawns an agent, a stop_request signals it, a deleted session's
process dies with its row. At-most-once, reconciled at boot; a failing effect is
telemetry, never a broken batch. Edges use name `dependency`: a triple has no
row key, so the comp names the whole sentence — `{type, child_eid}` links
eid→child, the same sentence with `gone: true` unlinks; both endpoints must
exist.

## Rendering (web + TUI, one registry)

`components/registry.ts` is the machinery: a **Renderer** =
`{view, match,
Render}` where `match(e)` returns a score — `has('doc','task')`
counts matched components, `true` = 0.5 for catch-alls; highest score wins the
view, ties go to registration order. `components/View.tsx` is the curated list +
the `<View eid view/>` front door. The TUI boots by `extend()`ing overrides
(same views, painted as terminal lines) — that's also the seam a future renderer
plugin would use. registry.ts imports no views, so anything may import matchers
from it without cycles.

**To add a view**: component file under `components/views/`, entry in View.tsx's
`define()` list; to make it a card tab, add its name to the tabs array there and
an icon row in `Card.tsx` + `components/icons.tsx` (vendored Lucide paths — add
a row, not a dependency).

## Navigation (web)

The URL is the root card: `/` is the root canvas, `/T-123` any entity
fullscreened, `?v=` its view — the App bar is that card's titlebar (title +
tabs), and the server serves index.html for any extensionless path. The
universal Id chip (`views/Id.tsx`) is the universal LINK, a real anchor:
cmd/middle-click and the browser's own context menu do the new-tab forms; plain
click (and tap) navigates in place. The custom menu ("open here" = the
deliberate in-place root change, plus "open in new tab") belongs to the CARD —
right-click its pin anywhere that isn't a link, input, or editable text
(`components/nav.tsx` owns route/navigate/menu, all guarded for the TUI). Below
navigation the menu lists the entity's VERBS, contributed per component with
UNION semantics (registry `defineActions`/`actionsFor`, curated in View.tsx like
the renderers): a task offers its status moves, a claim its release, anything
its delete. Adding a verb = one contributor row. A canvas offers a `List` view —
the mobile door — whose rows resolve through `List.Tile`.

## Map

| file               | owns                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `src/types.ts`     | THE vocabulary: comps, statuses, kindOrder/kindOf, prefix/idOf, all types  |
| `src/db.ts`        | SQLite schema, seed, `apply()` (patches in), `snapshot()` (graph out)      |
| `src/server.ts`    | Deno.serve: static+sucrase, /ws sync, /apply, /mcp mount, watcher          |
| `src/effects.ts`   | post-commit effect registry: created/changed/removed hooks per component   |
| `src/sessions.ts`  | managed sessions: spawn/stop/adopt a detached agent, tail its log file     |
| `src/adapters.ts`  | the provider table: argv, model/effort allowlists, init/terminal readers   |
| `src/freeze.ts`    | URL → monolith archive → scrub() → CSP-served, server-only                 |
| `src/client.ts`    | headless HTTP client: rows(), dot-params, find, change builders            |
| `src/query.ts`     | the FILTER grammar (ops/lists/ranges/time/text) — boards, CLI, MCP, search |
| `src/grammar.ts`   | GRAMMAR + FILTERS texts, derived from comps — CLI and MCP teach one page   |
| `src/commands.ts`  | the `:` verb table — one vocabulary: palette, TUI, CLI colon, MCP command  |
| `src/cli.ts`       | the `task` CLI (thin verbs over client.ts)                                 |
| `src/mcp.ts`       | MCP tool registry (io-agnostic; served in-process at /mcp and over stdio)  |
| `src/mail.ts`      | outbound mail: addressOf, mailed() delivery, the prose-only fanout + sweep |
| `src/mailer.ts`    | the native sender: Cloudflare Email Sending payload, send, the out-log     |
| `src/inbound.ts`   | the pull sweep: fleet-mail messages and hook spool → mail/hook entities    |
| `src/persona.ts`   | personas materialized: doc + tier edges → one markdown voice, .tasks files |
| `src/scribe.ts`    | the scribe's trigger: stub-marker queue → spawn the desk wearing the voice |
| `src/embed.ts`     | semantic vectors beside FTS: local embedder, sweep, /similar, dupe hint    |
| `src/telemetry.ts` | the `tool_call` log: record/recent + the /mcp body classifier              |
| `src/sandbox.ts`   | code mode's worker: permissionless, graph-only, postMessage SDK            |
| `src/live.ts`      | browser/TUI half: cache signal, socket, applyLocal/mutate, ent()           |
| `src/paste.ts`     | clipboard/drop text → entity spec (ids, URLs, JSON, plain text)            |
| `src/components/`  | web UI: registry.ts + View.tsx, nav.tsx (routing), Canvas, Card, Edit, …   |
| `src/tui/`         | fake DOM (dom.ts), ANSI painter (paint.ts), Md, App (vim keys), main       |
| `src/vendor/`      | preact/signals/snarkdown as plain ESM — no node_modules                    |

## Invariants — break these and things rot

- **The db is LIVE owner data** (`~/.tasks/tasks.db`). Never delete or reseed
  it. Schema changes: new columns get an `alter table` guard in db.ts `open()`
  (additive, in place); anything shapier needs the owner.
- **This repo is open source.** Never commit the db, fleet data, secrets, or
  anything from `~/code/holdco/.env`.
- **Server-stamped columns never ride the wire** — that's what keeps `frozen_at`
  (archive exists), `claimed_at`, and every managed-session lifecycle column
  (status, exit_code, final_text, …) honest. A session's REQUEST columns
  (provider, model, effort, requested_task_eid, persona_eid) are the
  wire-writable exception on purpose: creating a session with them IS the spawn
  request, validated by the created(session) effect — every failure is a failed
  Session on the board, never a 400. Stop is a `stop_request` entity; input is a
  comment aimed at the session. No session lifecycle routes exist; `/logs` and
  `/providers` are the only HTTP.
- **A managed session's stdout FILE is its durable log**
  (`~/.tasks/logs/<eid>.jsonl`, line number = seq): no log table, no ingester,
  nothing to drift. The server tails it and casts SUMMARY patches; the file is
  what a client reads back. And the agent is DETACHED behind a sh wrapper
  firebreak: the pid the runtime tracks is a launcher that backgrounds the
  setsid wrapper and exits at birth (deno --watch KILLS tracked pids on reload —
  unref is no shield, proven live — so the only safe tracked pid is a dead one);
  the agent is backgrounded into the orphaned wrapper's process group, and the
  wrapper — unknown to the runtime, so no reload can take it — traps INT/TERM —
  armed strictly AFTER the fork, or the agent inherits the ignore — then waits
  and reports the exit code. The restart re-adopts the run from its pidfile.
  Never add reaping. And a child inherits the SERVER's PATH: the service unit
  must carry the provider CLIs' dirs (claude, codex, deno) — a missing one is
  exit 127 with the stderr tail in the session row, not a mystery.
- **Frozen pages must render from their own bytes.** Self-containment is
  enforced at freeze time (scrub removes every external ref); the CSP at serve
  time is defense-in-depth, not the mechanism.
- **TUI: text content must never move the terminal cursor.** The painter
  sanitizes `\n`/`\r`/`\t` in text nodes; only the layout emits cursor moves.
- **One reconnect poller per process** (live.ts `polling`) — a down server must
  not stack pollers that all fire reload together.
- **The watcher's `graph` list in server.ts must cover every server import**, or
  edits to a server file merely reload clients against a stale process.
- Deleting an entity tombstones it; late patches for that eid are void. Death
  CASCADES to entities that exist about the dead one (cards viewing it, comments
  aimed at it, pins/cameras on a dead canvas or client) and detaches soft refs
  (claims by a dead session, tasks of a dead project). apply() returns the input
  batch plus a synthesized entity-null per casualty — always cast the RETURN, or
  client caches keep ghosts.
- There is NO 'blocked' status. Blocked is a fact about edges — an open
  `requires` dep turns the Dot red (`gated()` in live.ts); resolve the blocker
  or drop the edge.
- **A board is a saved QUERY, not an edge list** (`board.query`, src/query.ts
  grammar: `.project_eid=…&.status=open,wip`; empty = every task). Membership is
  never stored — a task is on a board because it matches, so it can't drift.
  Never add board→task `contains` edges. A board drop patches status/priority
  plus the query's scalar equalities (`adopt()`), so the dropped task JOINS the
  board it lands on.
- **Two dot-param grammars, one routing.** Writes (`param()` in client.ts) take
  values literally. Filters (query.ts `pred`) add operators: lists `a,b`, ranges
  `1..3`/`1...3`, `!=`, `~=` (contains), `<` `<=` `>` `>=`, `=` empty for
  absent. Boards, `task list`, and MCP task_list/graph_query all speak the
  filter grammar — extend it in query.ts and every door gets it.
- Full-text search is FTS5 over `doc` (external-content, trigger-synced —
  out-of-band doc writes are healed by the boot-time integrity check + rebuild
  in open()). One surface, four doors: `/search?q=`, `task search`, MCP
  `search`, `/` in the web UI. User words are quoted into terms (trailing `*` =
  prefix); snippets mark hits with \x01…\x02 — never HTML. Dot-param filters mix
  into the search line and screen the hits (query.ts is the one parser — bare
  words are text preds, so a search string IS a valid board.query: ⌘⏎ in the
  palette saves it as a live board). Time phrases (today, "1 hour ago") name
  RANGES; ops pick their edge.
- **Telemetry is log data, not graph.** `tool_call` (telemetry.ts: MCP calls,
  HTTP writes, browser crashes) carries no eid and no components, so snapshot()
  never walks it and no client cache holds it — read it at `/telemetry`,
  `task telemetry`. Recording NEVER throws: a failure to watch must not break
  the thing being watched, so record() warns and moves on.
- Bounced claims are audited: apply() records each rejection as a server-minted
  `conflict` entity (loser/holder as strings — the loser's session row may die
  in the same rollback). `graph_query kind=conflict` is the contention report.
- **The comms bus is a cursor, not a queue** (`notices()` in client.ts): any
  task tool told the caller's session appends unseen comments on its claimed
  tasks + comments aimed at the session entity (commenting on S-31 IS messaging
  that agent), then advances `session.acked_at`. The cursor is wire-writable on
  purpose — a session forging its own cursor only deafens itself. Serve lines
  and ack in the same breath, never ack unserved lines.
- MCP ergonomics are load-bearing: `task_new` batches via `tasks:[…]`, and
  `eid`/`*_eid` values accept human ids (T-3, P-19) everywhere — an agent should
  never need the num→eid lookup dance. If a real agent shells out to `deno eval`
  instead of using a tool, treat it as a bug report (T-3568).

## Principles

These hold everywhere in this repo, whoever — or whatever — writes the code:

- **Simplicity first.** The smallest change that solves the whole problem; touch
  only what's necessary.
- **Root causes, never workarounds.** When you find a bug, fix the bug — never
  route calling code around it. A workaround hides the bug and leaves the debt;
  the only acceptable one is temporary, with a TODO naming the root cause.
- **Challenge your own work.** Before presenting a non-trivial change, ask
  whether a more elegant shape exists. A simple fix that leaves the bug is not a
  fix.
- Don't call things "real", "actual", or "honest" — an AI tic; say what it is.
- `docs/STYLE.md` is normative for every line here — read it before writing.

## Working here

- Run: `deno task dev` (port 5173), `deno task tui`, `task` CLI
  (`deno task install`), MCP at `POST /mcp`.
- Gate: `deno task check` (fmt + lint + typecheck) AND `deno task test` must be
  green. Tests live beside their subject as `*_test.ts` — pure seams only (apply
  semantics, dot-params, change builders, scoring); the interactive layers are
  verified by probes (below), not mocks. **Piping a gate eats its exit code**
  (`check | tail` exits as tail; `;` after it un-guards the `&&` chain) — echo
  `${pipestatus[1]}` and READ it before acting on the result. This has let a
  lint failure ride to main and removed a worktree under an unmerged branch
  (both 2026-07-22) — the trap earns its ink.
- **Verify end-to-end before done** — the holdco standard. Recipes that work
  headless: screenshot
  `google-chrome --headless=new --screenshot=x.png
  http://127.0.0.1:5173/`;
  drive hovers/keys/clicks over CDP (`--remote-debugging-port`); TUI via
  `tmux new-session -d` + `send-keys` + `capture-pane -p` (`-e` keeps ANSI).
  Clean up any entities a probe creates (delete = `{name:'entity', comp:null}`).
  Probe servers must pick UNIQUE ports: the server binds `reusePort`, so two
  probes on one port silently round-robin — one agent's stale modules fed
  another's browser mid-verification (observed twice, 2026-07-20/21).
- **The injection loop**: `.claude/settings.json` runs `task context --hook` on
  SessionStart — agent sessions boot into their claimed work (`task context` /
  MCP `task_context`, same digest). The hook must NEVER fail loudly; a dead
  server (or an uninstalled CLI — hence the `|| true`) means no digest, not a
  broken session. SessionEnd mirrors it: `task wrap --hook` releases the
  session's claims, commenting on anything not done ("lease lapsed") — no
  timers, ending the session IS the wrap. Continuity is SELF-AUTHORED: wrap
  captures the transcript's last assistant message — the closing summary the
  operator already wrote — as the session doc (a hand-written doc is never
  clobbered), and the next digest opens with `## previously` — the newest brief
  by the same operator (`session.actor_eid`). Only a session that captured
  nothing gets the ledger STUB, which queues the scribe's sweep — an
  enrichment, never the continuity path; `:scribe S-31` summons the desk
  deliberately for a marathon a final message can't cover. SessionStart also
  reifies the session entity under **Claude's own session id**
  (`CLAUDE_CODE_SESSION_ID` — it rotates on `/clear`: the old S-\* wraps,
  a new one reifies, one brief per life; identity across clears is the
  ACTOR), plus cwd (the worktree it ran in) and the claude process `pid`
  (the /proc walk, src/proc.ts) that the channel plugin follows across
  rotations. `TASKS_SESSION` survives only as the launcher fallback for
  managed non-claude spawns. The hooks are
  the global CLI, no repo-local shims — any repo gets the loop by carrying the
  same two settings lines.
- **The graph IS your memory** (harness auto-memory is disabled — there are no
  local memory files; do not create any). Recall arrives at boot: the context
  digest's `lately` block (today/this week, hot-ranked) plus the `### memory`
  index lines (M-* entities). Deliberate recall is `memory_recall` / `task
  search`. To remember something durably, write the graph: a lesson or
  correction → `memory_save` (type feedback/project, scoped to the project
  entity); the session's own story → its session doc (S-*, the work-session
  pattern — S-3678 is the exemplar); anything task-shaped → a task with the
  context in its body. Reading a memory's body bumps its recall — use, and the
  graph remembers that you used it; disuse decays. Facts need no filing at all:
  every write is already journal-attributed (`task history`).
- The MCP surface has two tiers: task_* sugar and the generic tier
  (graph_query/graph_apply/ui_state/card_*/code_run). The generic tier is
  possible because the UI is data — cards/pins/cameras are entities; keep it
  that way. code_run REQUIRES `--unstable-worker-options` (already on the
  dev/mcp tasks) and `deno: { permissions: 'none' }` on the worker — never widen
  those permissions; the sandbox's only capability must stay the postMessage
  graph SDK.
- Hot reload: client-file edits broadcast `reload`; server-graph edits restart
  the process (websockets close, clients poll back). The TUI exits 42 to ask its
  wrapper loop to relaunch it — don't "fix" that exit code.
- Git: **worktree-only** — never edit the main checkout directly. Every agent
  (interactive sessions included) works in its OWN worktree and lands work with
  `git merge --ff-only`; focused commits. One writer per worktree: two agents
  sharing an index stomp each other's staging.

## Backups

`~/.tasks` is itself a git repo, pushed to a PRIVATE remote
(github.com/jeffpeterson/tasks-data — data never enters THIS repo). `bin/backup`
runs hourly from cron: it snapshots the live db atomically
(`VACUUM INTO snap/tasks.db` + integrity_check — the live `tasks.db` is
gitignored and must never commit, a commit could catch it mid-transaction), then
commits and pushes everything else (frozen/, future images/md) as plain files.
Restore = clone, copy `snap/tasks.db` → `tasks.db`, start the server. If blobs
ever outgrow git, the planned escape hatch is restic → R2 (encrypted, deduped,
retention) — see the holdco board.

## Style

- Deno + TypeScript, `let` everywhere (no `const` ceremony), no classes, no
  frameworks beyond vendored preact. Prefer small exported arrow functions.
- Comments explain the WHY and the invariant, not the next line. Every file
  opens with a paragraph saying what it owns. Keep that true.
- CSS is hand-written (src/styles.css): `Block_Element-modifier` names, custom
  properties as the variant mechanism (`--bleed`, `--dot`), modern CSS, no build
  step. Everforest palette; the TUI mirrors it in paint.ts.
- Known trap: CSS `anchor()` does not resolve inside a transformed ancestor (the
  canvas plane) — tooltips position off their trigger instead.

## Plugins (direction, not yet built)

The seams a plugin story will use already exist: `extend()` for renderers, the
`comps` list for data models, `mcpServer(io)` for tools, the CLI verb table.
Keep those narrow and curated — a plugin should be "a module that exports
Renderer[] / a comps fragment", not a framework. If a change makes one of these
seams wider or leakier, that's the wrong direction.

## Preloaded

### M-4474 document new fleet tooling in a memory so the fleet discovers it

When you build or discover new fleet tooling — a CLI verb, an MCP tool, a hook, a workflow, a colon-command — write a memory for it immediately (reference or feedback, unscoped so it rides every operator's `task context` digest).

Tooling nobody memorializes is invisible: the next operator learns it by accident, or the owner has to tell them. A one-line index in the digest is how the fleet finds out **passively** — put the knowledge where the need arises.

Applies to what you ship AND to what you notice someone else shipped.

### M-4458 code style — the values, omissions, and which strata to imitate

Source: `docs/STYLE.md`. The meta-layer under every language rule: **small composable parts, examples over prose, no speculative abstraction.** `docs/STYLE.md` is normative for all fleet code; for a language it doesn't cover, carry these values into that idiom.

## What he deliberately omits (the clearest statement of the values, from the flux comments)
- **No middleware/thunks** — logic scatters out of reducers into closures; kills debuggability.
- **No keyed/combined reducers** — every reducer sees the full state and every action.
- **No action creators** — an abstraction that only renames things doesn't get built.
- **No memoized selector layer** — subscribers get the whole state.

The proof the style scales: `runtime.js` is a complete logic language in ~700 lines where every feature is a plain function over `env`, callable in isolation, each with its `///` doctest. Simple parts → complex whole.

## Which strata to imitate (provenance)
Both corpora have strata; imitate the **hand-written** layers, not agent-written or experimental ones.
- **yak-sh ground truth:** pre-2025 `lib/` (`fp.js`, `core.js`, `runtime.js`) + the `e50b58d` refit. **Not normative:** work-era TS relics, `const`-heavy playground dirs, the flat-CSS experiment, the OOP test wrapper, the post-2026-03 LLM burst (owner-reviewed but LLM-authored). The burst's reliable negative lesson: mimicry gets surface tokens right (`let`, doctests) and *module granularity* wrong (1,600-line monoliths where his hand writes many small files).
- **cafe_car ground truth:** everything before 2026-06-26, especially `lib/cafe_car/component.rb`, the `*_builder.rb` family, `core_ext/`, and the whole `ui/` CSS system. **Not normative:** operator-era paragraph-prose comments, copilot/dependabot commits, the `helpers.rb` `cat`/`cap` debt cluster.

His DNA register is terse + example-driven — never paragraph-essay comments. When mimicking surface tokens, get the granularity right: many small files, not a monolith wearing the right syntax.

### M-4456 code style (CSS) — the scaling component system

Source: `docs/STYLE.md` (product ground truth: `cafe_car/app/assets/stylesheets/ui/`). Designed to scale — one file + one import + a var contract per component, so adding UI never touches existing files and re-skinning never touches structure. (yak-sh's own flat-CSS minimalism was an experiment that doesn't scale — don't imitate it.)

- **One file per component**; PascalCase filename = the block (`Card.css` → `.Card`). The `components.css` manifest is nothing but `@import` lines — a new component is one file plus one import.
- **Three-separator naming:** block `.Card` (PascalCase); element `.Card_Head` (underscore, PascalCase); modifier/state `.Button-primary`, `.Card-sticky` (hyphen, lowercase).
- **Custom properties are the variant + theming mechanism** — the scaling trick. A component declares local vars at the top and consumes them (`--background: var(--button)` … `background: var(--background)`); a variant just *re-points* a var (`.Button-primary { --background: var(--primary) }`), never re-declares rules. Semantic tokens layer over primitives (`--danger: var(--red)`) plus a calc-derived spacing scale (`--gap`, `--half-gap`, `--radius`); a theme is a var-override file. Structure and skin stay fully separable.
- **Lean on modern CSS:** zero-specificity `:where()`, `:is()`/`:has()`, native nesting `& + &`, container queries, `color-mix`, `color-scheme: light dark` with per-component dark overrides.
- Still **no preprocessor, no Tailwind, no build step.**

### M-4455 code style (JS/TS) — module shape, the whole app, testing

Source: `docs/STYLE.md`. How a file, app, and test suite are shaped.

## Module shape
A file is a vocabulary composed top-to-bottom: `id`, `always`, `tap`, then `inc = add(1)`, `reject = compose(filter, negate)`. A function longer than ~10 lines is rare and always a genuine algorithm — there is no "orchestrator" function. State is an immutable-ish plain value threaded through functions ("mutation" is copy-tweak-return: `beget(env, e => e.k = v)`). Generators for streams of alternatives — laziness/backtracking fall out of `yield*`, not a scheduler class.

## The whole app
- **Platform is the framework.** Deno (permissions in the shebang), no `package.json`, no bundler, no build step — browser and server run the same ES modules; shared `lib/` is isomorphic.
- **~Zero dependencies, vendored.** Rare deps copied into `vendor/` via an import map. Server, test runner, DOM builder, store are hand-rolled small `lib/` files.
- **Pure core + thin imperative shell.** A pure curried data module (`sim.js`, its own doctests) + a small DOM shell (`main.js`: module-level `let` state, `querySelector` bindings, `addEventListener`, template-literal `innerHTML` or a variadic `tag()` builder, `requestAnimationFrame` loop). No JSX, no vdom, no reactive lib.
- **Server** is a hand-rolled ~60-line middleware `Application` (`app.use(fn)`, recursive stack) + small middlewares. Deploy is a Dockerfile running the dev server. HTML minimal: no `<head>`/`<body>`, unquoted attrs, one `type=module` script.

## Testing
No test-framework dependency, ever. Doctests are *discovered*: a runner scans for `///` lines and codegens a test module (`->` equality, `~>` pattern-match, `/// let` setup, `// /` skip). Scenario tests in `*.test.js` using a tiny in-repo `suite(name, ({it, equal, ok}) => …)`; benchmarks in `*.bench.js`. CI is one job running `bin/test`.

### M-4454 code style (JS/TS) — the ten rules

Normative for all fleet code (source: `docs/STYLE.md`, the owner's DNA). JS-flavored; carry the same values into any language's native idiom.

1. **`export let name = curried => arrow`** — small, config-first / data-last, composable. 2-space indent everywhere, no semicolons, single quotes, loose `==` by default. One expression per function where possible. `let` by default; `const` only for true module constants (often SCREAMING_CASE). Named `function` only where you need recursion/hoisting/`this`/generator. Wrap code + comments at 80 cols; break long arrows after `=>`.
2. **`///` doctests over prose.** Executable examples (`input -> output`, `~>` async/pattern, `/// let` setup, `// /` skip) are spec + docs + tests at once. Prose comments are for *rationale* — especially what's deliberately absent.
3. **No classes** unless long-lived identity — then public fields, arrow-bound methods, no deep/domain inheritance. Thin `extends` of platform types (`Error`, `EventTarget`, `HTMLElement`) is fine. Else a factory closure returning a plain object of functions; compose with mixins, not hierarchy. PascalCase filename = one identity module; lowercase = a function vocabulary.
4. **Effects are data.** Record them as events/tuples appended to state or a log, resolved by a separate pass — never performed inline where decided. All comms serialized through the store's state.
5. **Dispatch with a `when`-style table** (value-dispatch on a computed tag, `_` default). A small leaf `switch` is fine; the banned thing is the switch-shaped orchestrator sequencing phases. Prefer a ternary chain over a 3-case switch.
6. **Nil short-circuiting over defensive `if`s** — a `pipe` that stops on nil replaces most error plumbing. Errors are tiny `Error` subclasses used as control flow, plus `??` defaults — no result types, no wrapping layers. Async is transparent: go async only when an input is a promise.
7. **TypeScript, worn lightly.** `.ts` by default, named honestly. Types carry meaning at signatures and data boundaries; inference does the rest. Keep `///` doctests. No `as` casts, enums, `private`/`readonly` ceremony — simplest annotation that states intent.
8. **Names: short, lowercase, evocative** (`ok`, `walk`, `beget`, `tap`, `when`), 2–8 chars; the call site reads like a sentence. No verb-prefix ceremony (`createContext`→`context`); named imports so call sites read bare. Prefix/namespace only to *disambiguate*, never as ceremony. No `Manager`/`Factory`/`Impl`; variants get a suffix (`map`/`mapObj`), not an options bag.
9. **Don't build the speculative layer.** An abstraction earns its place by removing code from callers, not adding indirection. Leave a visible stub or a comment saying why the layer is absent.
10. **Build a vocabulary, then compose it.** A file reads top-to-bottom as later exports made of earlier ones (`export let inc = add(1)`). Complexity comes from composition, never a long phased body. Primitives are protocol-extensible. A module tops ~600 lines; grow a system as many small files, never a monolith.

### M-3715 delegation discipline

Owner direction (2026-07-20) on delegation in ~/code/tasks:

- **Worktree-only, one writer per worktree.** Every agent — harness spawns and the coordinator's own session — works in its own git worktree, lands via `git merge --ff-only`. Use the Agent tool's `isolation: "worktree"` for spawns; never let two agents share an index (the h1/domain-editor serialization was this lesson).
- **Harness spawns are the default and must integrate fully**: every spawn brief directs the agent to reify a session entity, claim its task under that identity, comment progress and completion (with sha), and release when done. The task body carries the full spec — the prompt is delivery, the task is the record.
- **Internal spawns** (wire-created sessions, `task spawn`) are for codex/other providers and well-specified cold-context work; at parity since T-3698 (auto-claim, session_peek, settle→bus). The harness is the reliability floor.
- **Communication flows through the graph, not harness-native channels**, wherever possible: comment on a session to steer it, comment on the task for the record; the comms bus delivers on the next tool call. Harness push notifications remain the wake channel until the graph grows one.

**Why:** if our system breaks, work continues on the floor; full integration means the board is always the truth about who is doing what.
**How to apply:** every Agent-tool spawn gets isolation worktree + the claim-discipline paragraph in its brief; prefer task bodies over prompt-only specs. Current thread: M-3714.

## Index

Recall a body by id (memory_recall / task show).

- M-4457 feedback: code style (Ruby/Rails) — the class-macro idiom · 1×
- M-4062 feedback: letters vs notices: email is for prose agents wrote; machine events are marked at mint
- M-4064 project: identity is faceted; personas differ by emphasis, not content · 1×
- M-4065 project: federation discipline: one home graph per entity, intents across boundaries, no consensus · 1×
- M-4066 feedback: agents take warm paths, not right paths — adoption is won structurally · 1×
- M-4061 project: vocabulary naming: artifacts get artifact names, pure acts keep _request
- M-4063 project: reference at authoring, resolve at delivery, record the served form
