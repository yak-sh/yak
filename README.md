# Tasks — the fleet entity graph

One SQLite file is the holdco fleet's shared memory: tasks, projects, boards,
docs, comments, agent sessions, mail, memories — one graph, worked by humans and
agents through the same doors. A web canvas, a terminal UI, a `task` CLI, and an
MCP server all speak one wire; every change is an entity patch, every list a
query.

## The model

Everything is an **entity** — a client-minted uuid plus a server-minted number —
that carries **components**, one row per component table under the same id.
There is no `kind` column: an entity _is_ what its components make it, and
`kindOf()` derives a display name with a typed short id (`T-123` task, `P-19`
project, `S-31` session, `M-40` memory, `E-9` mail…).

- a **task** is `doc` (title/body) + `task` (status/priority/project/assignee)
- a **board** is `doc` + `board(query)` — a saved filter over tasks, never a
  stored list: a task is on a board because it matches, so membership can't
  drift
- a **comment** is `doc` + `comment(target_eid)` — aimed at ANY entity;
  commenting on a session IS messaging that agent
- a **session** is an agent run, reified; a **claim** is its lease on a task —
  the server refuses to hand a held lease to another session
- mail, memories, personas, people, webhook deliveries are entities too — one
  vocabulary (`comps` in `src/types.ts`) that every door derives from

**Edges** are typed sentences between entities: `requires` (hard gate),
`contains` (decomposition), `reads` (read-first), `about` (subject reference).

The wire is a flat batch of patches — `{eid, name, comp}`: omitted columns
untouched, `comp: null` deletes the component, `{name:'entity', comp:null}`
tombstones the entity. Browser tabs sync over `/ws`; headless clients POST
`/apply`; both broadcast to everyone else.

Beside the graph sit FTS5 full-text search over every doc and local semantic
embeddings — one index behind `/` in the web UI, `task search`, MCP `search`,
and `/search` + `/similar` over HTTP.

## The doors

- **Web canvas** — `http://localhost:5173`. The URL is the root card: `/T-123`
  fullscreens any entity, `?v=` picks its view. Cards, pins, and cameras are
  entities themselves, so the UI state is graph data like everything else.
- **TUI** — `task tui`: the same app painted as ANSI lines on a fake DOM, vim
  keys, another live client — edits made in a browser appear on the next frame.
- **CLI** — `deno task install` puts a global `task` on PATH. Dot-params route
  by prop through the component vocabulary (`.title=` can only mean
  `doc.title`); the same grammar filters and writes:

  ```sh
  task list .status=open .priority<=1
  task new P1 .project=holdco Fix the flux capacitor
  task set T-3 .status=done --comment="verified end-to-end"
  task claim T-3 && task release T-3
  task mail                      # your unread fleet inbox
  task search flux capac*
  task help grammar              # the whole filter grammar
  ```

- **MCP** — the server IS an MCP server: `POST /mcp` (Streamable HTTP,
  stateless), or `deno task mcp` over stdio. Two tiers: `task_*` sugar
  (list/new/update/show/claim/release/comment/context…) and the generic tier —
  `graph_query` / `graph_apply` (the raw wire), `ui_state` / `card_*` (the UI is
  data), `search` / `memory_*`, and `code_run`: agent-written JS in a
  permissionless sandboxed worker whose only capability is the graph.
- **Mail** — a mail is an entity whose `doc` carries subject and body; creating
  it requests delivery. Local-first: a fleet recipient is delivered in-graph
  instantly, and only external mailboxes ride the Cloudflare edge. `task mail`
  is the inbox; unread verified mail flows into live sessions through the
  channel plugin.
- **Channel plugin** (`channels/`) — a Claude Code channel that pushes comments
  and knocks aimed at a session INTO its running transcript, fed by the same
  `/ws` broadcast every browser hears. `task claude` launches an interactive
  session fleet-wired; `channels/README.md` has the mechanism and enablement.
- **HTTP** — `/snapshot` (the whole graph in one gulp), `/apply`, `/ws`,
  `/search`, `/similar`, `/query`, `/journal` (write history), `/telemetry`.

## Agents in the graph

A session is an entity from boot: the repo's SessionStart hook runs
`task session context --hook`, which reifies the session and injects its claimed
work as the boot digest, led by the session's own meta as frontmatter;
SessionEnd runs `task session wrap --hook` — claims released, the closing
summary kept as the session's brief (`task session brief` writes one
deliberately). Sessions also spawn FROM the graph
(`task spawn T-3 --provider=codex`): creating a session entity carrying a
provider IS the spawn request, and everything the run learns — status, branch,
exit code, final text — is server-stamped onto the row. Memories
(`task remember`, MCP `memory_save`) let a lesson outlive the session that
learned it; recall decays with disuse and use bumps it.

## Run

```sh
deno task dev      # server + web on http://localhost:5173
deno task tui      # the terminal UI (needs dev running)
deno task install  # global `task` CLI
deno task check    # fmt + lint + typecheck
deno task test     # the suite
```

The db lives at `~/.tasks/tasks.db` — outside the repo; set `DB_PATH` to move
it. First boot plants the schema. No bundler, no node_modules: the server serves
`src/` as-is, translating TS/JSX per request (sucrase), and the browser resolves
preact/signals/marked to vendored ESM through the import map in `index.html`.
There is no auth — the server is built to live on a private tailnet.

## Pointers

- `CLAUDE.md` — the contributor guide: the data model in one page, the file map,
  the invariants, the recipes. Start there to change anything.
- `docs/STYLE.md` — normative style for every line here.
- `channels/README.md` — the channel plugin: mechanism, identity, enablement.
