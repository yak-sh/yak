# Package architecture

The packages share a component-based data model. Applications choose the parts
needed for their storage, domain rules, UI, and external services. A local UI
store does not need an HTTP server; a database service does not need a renderer;
and the graph core does not depend on the agent harness.

Start with the [graph example](README.md#a-complete-in-memory-example) for a
working schema, write, and query. This guide explains what to add next.

## Shared concepts

- **Entity:** a stable EID, optionally associated with a human-facing number.
- **Component:** a named set of properties on an entity. Components describe
  independent aspects: a document can also be a task without changing identity.
- **Bundle:** the identity and components sent together. A write bundle is a
  patch; an ordinary query result contains the selected entity's components.
- **Vocabulary:** schemas defining components, properties, references, and
  extension keywords. Domain packages supply vocabulary documents and plugins.
- **Reference:** a property naming another entity. Reference rules determine
  what happens when the target is deleted. Relationships can also be represented
  by entities with `edge.from` and `edge.to` and a relationship component.
- **Query:** a parsed expression selecting or projecting graph data. Storage,
  subscriptions, renderers, and rules reuse query syntax, but each supports the
  subset appropriate to its purpose.

A component called `completed`, for example, can record a task's completion. A
query-time `task.status` can derive `done` from that fact rather than storing a
second status value that could disagree. Derived properties require the domain's
configured derivation support; naming a property `status` does not create it.

## Layers

```text
Application policy and UI controllers
  │                      │
  │ graph reads/writes   └── render + Preact/text/HTML/TUI hosts
  │
  ├── local client / subscriptions / optional synchronization
  │
  └── graph: vocabulary, admission, transactions, rules, plugins
        ├── storage: RAM / SQLite / D1 / Durable Object SQLite
        ├── extensions: keys, blobs, journal, search
        └── domain packages and post-commit effects
              └── external processes, Git, model providers, scheduled work
```

This diagram shows responsibilities, not a requirement that every request pass
through every package. For example, `graph.read` can be called directly against
RAM or SQLite without a client or transport.

### Data definitions and execution

| Package                                              | Responsibility                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| [vocab](../vocab/README.md)                          | Load component schemas and extension keywords.                    |
| [query](../query/README.md)                          | Parse query expressions into a shared representation.             |
| [match](../match/README.md)                          | Evaluate supported query conditions against bundles in memory.    |
| [sql](../sql/README.md)                              | Compile queries for SQL-backed adapters.                          |
| [graph](README.md)                                   | Apply changes, validate them, manage references, and run plugins. |
| [id](../id/README.md)                                | Identity-generation utilities.                                    |
| [key](../key/README.md), [alias](../alias/README.md) | Derived key entities and persistent names for entities.           |
| [names](../names/README.md)                          | Schema-driven choices of entity name fields.                      |

### Storage and transport

| Package                                                    | Responsibility                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [ram](../ram/README.md)                                    | In-memory transactional storage; useful for local state and tests.           |
| [sqlite](../sqlite/README.md)                              | SQLite storage and shared SQL write/schema machinery.                        |
| [d1](../d1/README.md)                                      | Cloudflare D1 adapter with its transaction constraints.                      |
| [durable-object](../durable-object/README.md)              | Storage over a Durable Object's embedded SQLite.                             |
| [blob](../blob/README.md)                                  | Transparent content-addressed storage for registered properties.             |
| [journal](../journal/README.md)                            | Record committed changes for history and synchronization.                    |
| [sync](../sync/README.md)                                  | Synchronization primitives over journaled changes.                           |
| [client](../client/README.md)                              | Local graph state, live queries, optional persistence and remote connection. |
| [api](../api/README.md)                                    | HTTP writes/queries and WebSocket subscriptions.                             |
| [edge](../edge/README.md), [workerd](../workerd/README.md) | Routing and Cloudflare deployment composition.                               |

SQLite and RAM implement the graph storage contract but have different query
capabilities and durability. Remote storage also has different transaction
constraints. Select an adapter based on the operations needed, not only where it
runs; its README documents those constraints.

`blob` changes storage representation, not the application's property type.
Callers still write and read strings. All readers of a blob-backed database must
use compatible blob-aware query/read wiring; a plain SQL reader can see content
addresses rather than text. Database upgrades and rollback therefore need
explicit compatibility planning.

### Domain and external work

| Package                                                      | Responsibility                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [doc](../doc/README.md)                                      | Document title/body components.                                        |
| [task](../task/README.md)                                    | Tasks, projects, dependencies, and completion/cancellation facts.      |
| [member](../member/README.md)                                | Membership and assignment-related domain vocabulary.                   |
| [mail](../mail/README.md)                                    | Email composition and delivery-related graph operations.               |
| [memory](../memory/README.md)                                | Stored reusable guidance and recall data.                              |
| [canvas](../canvas/README.md)                                | Spatial UI/domain data and operations.                                 |
| [effects](../effects/README.md)                              | Observe committed changes and run side effects.                        |
| [wake](../wake/README.md)                                    | Scheduling and wakeup behavior.                                        |
| [fts](../fts/README.md), [embedding](../embedding/README.md) | Text and vector-search support.                                        |
| [git](../git/README.md)                                      | Git object/reference data and host checkout integration.               |
| [process](../process/README.md)                              | Host process execution and supervision.                                |
| [context](../context/README.md)                              | Explicit instruction snapshots, provenance, and admission.             |
| [model](../model/README.md)                                  | Provider-neutral model request/response contracts.                     |
| [openai](../openai/README.md)                                | OpenAI request/response translation and provider integration.          |
| [session](../session/README.md)                              | Transcripts, execution, delegation, and fork relationships.            |
| [harness](../harness/README.md)                              | An application composing these packages into an agent runtime and TUI. |

A record of requested work is not the work itself. For example, a process entity
can describe execution state, but host code launches and observes the process. A
worktree entity describes a checkout; Git integration performs discovery and
creation. A task can remain unfinished after its worker session settles.

External operations cannot generally share a database transaction. Use durable
intent, observed results, and idempotent reconciliation where an operation can
succeed before its result is recorded. Do not assume a post-commit effect or a
restarted worker is automatically exactly-once.

### Rendering and interfaces

| Package                                              | Responsibility                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| [render](../render/README.md)                        | Query-based view and action selection.                                   |
| [preact](../preact/README.md)                        | Render host and UI integration for Preact.                               |
| [html](../html/README.md), [text](../text/README.md) | HTML and text render hosts.                                              |
| [markdown](../markdown/README.md)                    | Markdown parsing and structural rendering.                               |
| [tui](../tui/README.md)                              | Terminal layout, input, painting, reusable controls, and virtualization. |
| [cli](../cli/README.md), [mcp](../mcp/README.md)     | Command-line and model-tool interfaces.                                  |
| [yaml](../yaml/README.md)                            | YAML-oriented input/output utilities.                                    |

A renderer registration names a view and a matching query. When several
registrations match, query clause count determines specificity; registration
order breaks ties. A generic `.task` view can therefore be overridden by a more
specific `.task&.completed` view. This is selection, not cascading CSS: matching
renderers are not all combined automatically.

Renderers produce structure through a host. A text host, browser host, and
terminal host need not produce identical output, but can share the selection
rules and content. ANSI escape sequences belong in terminal painting, not in
stored Markdown or portable domain renderers.

## End-to-end application flow

Consider a task list with a browser UI:

1. Compose a vocabulary and task plugins with a storage adapter.
2. A controller applies a task bundle. The graph validates and commits it, then
   publishes the applied change to configured observers.
3. A local or remote query subscription updates the matching task list.
4. A renderer chooses a view from each bundle's components. Pure controls
   receive values and callbacks; they need not know about the graph.
5. A completion gesture writes the completion fact. The derived status and
   renderer selection update from that state instead of a separate UI status.

For remote clients, add authentication and authorization at the API boundary,
then a journal/synchronization strategy appropriate to the application. Do not
assume a component schema alone enforces access control.

## Durable data versus UI state

The same component model can represent both, but they should not automatically
share a persistence or synchronization policy.

- Domain facts such as task completion and session entries normally persist.
- Selection, draft text, expansion state, and a viewport's item-relative anchor
  can live in a private local client graph. Configure persistence explicitly;
  `persist: 'none'` marks components that should remain ephemeral where
  supported.
- Parsed text, line-layout caches, DOM references, and event handlers are
  rendering implementation details, not necessarily graph data.

A controlled textarea or virtual list can accept state and change callbacks. The
application adapter stores that state in a graph. This keeps controls reusable
without introducing a second application-state store inside them.

Query-based rendering alone does not guarantee incremental performance.
Subscription granularity, query execution, stable item identity, and viewport
virtualization also matter. Test work counts on large collections: an input edit
should not require parsing every transcript item. The harness documents its
remaining coarse domain-refresh behavior in its package documentation.

## Runtime boundaries and failure handling

Portable packages use standard language/web interfaces. Host entrypoints such as
`@yaks/context/host` and `@yaks/git/host` perform filesystem or process work.
Choose entrypoints explicitly rather than importing host code into a browser
bundle. A provider adapter owns protocol-specific mapping; it should not change
session history to fit a transport.

Transactions protect database changes, not external files or remote requests.
Log unexpected errors independently when database failure could prevent graph
recording. Keep a known-good runtime and compatible database backup before an
upgrade that changes storage representation. A Git worktree separates source
files; it does not isolate a shared database or external services.

## Choosing a starting point

- **Local application state:** graph + vocab + ram, or client for live queries.
- **Persistent service:** graph + vocab + sqlite, then domain plugins and an
  API.
- **Cloudflare service:** the applicable D1 or Durable Object adapter and
  deployment packages; review transaction and runtime constraints first.
- **Query-selected UI:** render plus a host, with client subscriptions or your
  own state adapter.
- **Agent application:** inspect harness for a composition of session, context,
  model/provider, process, Git, and terminal packages. The other packages do not
  require the harness.

The READMEs linked above describe package-specific APIs and limitations. The
examples and architecture here are not a promise that all adapters support every
query or that all host features work in every runtime.
