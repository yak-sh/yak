# Frontend graph pilot

Each mounted frontend owns a local-only `@yaks/client` over RAM. All UI
components declare `persist: none`; no URL, socket or vault is configured.
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
6. Draft is currently per frontend, preserving the existing behavior across
   session switches. Per-session drafts can become separate draft entities
   without a widget change.

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
