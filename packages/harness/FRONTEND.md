# Frontend graph pilot

Each mounted frontend owns a local-only `@yaks/client` over RAM. Most UI
components declare `persist: none`. Draft recovery records declare
`persist: local` and use the client vault. No URL or socket is configured.
Identical local entity IDs in two clients deliberately refer to different
frontend instances. `App` also accepts an application-owned `frontend` so other
controls/tests can read and mutate the same state.

- `frontend`: selected session, selection generation, show-settled.
- `composer`: message/task mode.
- `feedback`: visible error.
- `draft`: source text and cursor offset.
- `viewport`: per-transcript item identity/row offset and follow-end.

The generation distinguishes selecting _new_ again from the earlier pending
new-session request. Promises stay outside the graph; they are execution
machinery, not serializable state. A completed stale request cannot steal the
newer selection. Errors are graph data.

`@yaks/client` query watches use Preact signals. Draft, composer, feedback and
viewport have separate entity subscriptions, so typing/mode changes do not
render the application or read the transcript. The editor is selected by a
`.draft` renderer through `@yaks/render` and `@yaks/preact`. Reusable widgets
have no graph imports: Textarea takes `value`/`onEdit`, VirtualList takes
`value`/`onViewportChange`. Their uncontrolled APIs remain available to other
applications. Local refs coordinate event bursts and cache measurement; the
harness has no `useState` or refs mirroring selected mode/draft/filter state.

The domain graph remains authoritative. Existing asynchronous `UIAgent` methods
return read-only query projections; the frontend does **not** insert copies of
session/task/entry entities into its RAM graph. No transient state is inserted
into the durable harness graph.

## Pilot findings / unfinished larger seam

This is **not** the finished ideal graph frontend yet:

1. Domain updates still use the existing coarse `changes` subscription and
   asynchronous projection batch in App. A domain write may reread the full
   transcript and all panels. Replacing that with per-panel incremental query
   projections requires a shared async projection lifetime API and careful
   handling of fork-inherited transcripts/derived session status. Merely copying
   the results into another graph or renaming setters would hide the problem.
   Typing and scrolling do not enter that path.
2. `@yaks/preact`'s entity adapter wants synchronous entity reads; the SQLite
   graph and `UIAgent` facade do not supply the same contract as a RAM client.
   `@yaks/client.watch` already supports async first reads, but doesn't expose
   readiness/error state. A reusable async adapter should make those facts
   explicit before replacing every harness data projection.
3. Query identity needs `entity.eid` declared in the frontend vocabulary even
   though bundles always carry identity. This is boilerplate worth revisiting.
4. Native renderer context is untyped `unknown` for caller-specific callbacks;
   the editor boundary currently needs casts. Typed context composition would
   improve ergonomics without teaching widgets about the graph.
5. Layout publishes the logical viewport after measurement. Caches, renderer
   trees, estimated heights and transient pending movement remain local to the
   generic widget. Repeated unchanged publications are suppressed; huge single
   entries still incur full parse/layout, as before.
6. The active editor is an ephemeral projection of a per-session local draft.
   Submission receipts retain unacknowledged text until the backend confirms
   admission. These local records are never sent through domain synchronization.

A small shared-package fix accompanies the pilot: closing a client/watch before
its asynchronous initial read finishes can no longer resurrect that watch. Tests
cover both lifecycle races.

## Performance contract

A deterministic test mounts 10,000 transcript entries, selects the session, then
types. It asserts fewer than 100 entries were rendered initially and **zero
additional entry renders or domain queries while typing**. Existing
virtualization/anchoring/mouse/scrollbar tests remain part of validation.

## VISUAL source selection pilot

Selection mode, source snapshot, anchor/cursor and local yank live in a private
`visual` component. Only its indicator subscribes; generic TUI surface callbacks
read editor state or one virtual item. Keys update that component and request a
paint; they do not refresh domain projections. `useVisualController` is the host
adapter, not a graph dependency in TUI components.

This first slice uses a temporary plain **source view**, preserving
draft/Markdown bytes rather than attempting to reverse-map styled terminal
cells. It supports one item at a time (`[`/`]` choose neighbors), not cross-item
ranges. This exposes a remaining package seam: rendered-cell selection needs
source-span metadata in portable Markdown renderers, plus
grapheme/display-column mapping. Do not infer source offsets from ANSI or
eagerly render history to paper over that gap.

### Transcript publication and pending submissions

Transcript refreshes publish independently of asynchronous sidebar projections.
A new graph change schedules a follow-up read without discarding the current
valid read. Requiring a completely quiet graph before publishing can starve the
transcript while other sessions continuously produce events. Selection identity
and generation still reject results for a previously selected session.

Submitting a message must admit it to the graph without waiting for an active
provider request. Entry sequence allocation happens at transaction commit. A
reply acknowledges only the input boundary recorded on its ask; messages
admitted later remain pending and are included in the next request, including
when using a provider continuation anchor. This is authoritative graph state,
not an optimistic frontend copy. Rendering now also distinguishes ask entries
carrying `using` metadata from real user content; provider configuration is not
an author role.

The domain subscription remains coarse: all graph changes can trigger transcript
reads. This change removes the sidebar/quiet-period publication barrier, not the
need for dependency-aware projections. Worker startup and initial subscription
transfer latency still apply to the first selection.

### Keyboard modes

The `keyboard` entity stores mode, focused region, help visibility, and pending
`g` in the private frontend graph. The draft view observes mode only to hide its
cursor outside INSERT; normal input still changes only the draft query.
`useKeymap` is a graph-free interception layer, and named `useKeys` targets let
NORMAL commands address the transcript without reordering the editor's focus. A
regression found during this work demonstrated why target registration and focus
registration must have separate lifetimes when the selected session changes.

NORMAL uses row scrolling (`j/k`) and page scrolling (`h/l`), not a persistent
rendered-text cursor. `v` selects the anchored item's source, so it retains the
same source-mapping and cross-item limits as the previous VISUAL implementation.
Sidebar focus uses sibling/parent/child navigation. Help is mounted only while
requested with `?`. Modified legacy actions remain aliases, not a second mode.

## Local draft recovery

The terminal host opens a `@yaks/client` Vault before mounting the UI. Only
`savedDraft`, `pendingDraft`, and `recovery` enter it; domain replicas, prompt
context, visual selections, and credentials do not. The vocabulary explicitly
registers `syncKeywords`; declaring `persist` without registering the extension
would silently use the default wire tier.

Drafts include source text, cursor, and message/task mode for each session and
for the unsent new-session composer. The last selected session and local yank
also recover. Changing sessions selects its own draft. Submission clears the
editor immediately but retains a pending local record until admission succeeds;
a failure restores that text ahead of any newer edits. A restart restores
unacknowledged submissions as editable text, never automatically resends them.
Admission may already have succeeded remotely, so inspect the transcript before
resending recovered pending text. Checkpoint files are individually atomic, not
a transaction spanning every local record; a crash during acknowledgement can
recover text that was already sent rather than lose it.

`Ctrl+U` intentionally clears the draft and retains the yank. `Alt+p` inserts
the local yank at the current draft cursor, including after restart.

Default storage is `~/.harness/drafts/<profile>/`, with private directory/file
permissions (0700/0600). These are unencrypted JSON files: do not type secrets
unless that local-at-rest policy is acceptable. `HARNESS_DRAFT_DIR` relocates
the root. Profile identity combines the configured database path and
`HARNESS_FRONTEND`, falling back to the tmux pane or terminal device. Set a
stable `HARNESS_FRONTEND` to recover the same draft after replacing a terminal
window. Different profiles are isolated; an OS file lock rejects simultaneous
writers to one profile. Stop that frontend and remove its profile directory to
erase its recovery data. There is no automatic retention expiry. Programmatic
`frontend(false)` remains memory-only; `frontend(vault)` accepts browser
IndexedDB or another standard client vault. Await `ready` before mounting and
`flush` before closing. Host startup refuses malformed recovery records rather
than silently deleting drafts.

Writes run asynchronously in order, off the keyboard rendering path; shutdown
waits for them. An abrupt process kill can lose edits not yet written, and
writes are not fsynced for power-loss durability. Write failures appear in
feedback and make `flush` reject. The file adapter rewrites only changed local
entities, not the whole graph, but does not yet debounce repeated edits to a
very large draft.
