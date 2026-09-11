# Transient text projections (experimental)

`transient(graph)` adds an in-memory text projection to an existing graph. A
writer opens a string property on an existing entity, appends text, and either
checkpoints, commits, or discards it. No SQL writes, graph effect hooks, or blob
versions are produced by an append.

```ts
import { transient } from '@yaks/graph'

const writer = await transient(graph).begin(id, 'content', 'body', requestId)
writer.append('Hello')
writer.append(' world')
await writer.checkpoint() // durable value; the projection remains active
await writer.commit() // durable value, then ends the projection
// Alternatively: writer.discard() restores the latest durable value.
```

The writer ID must be unique for the graph's lifetime. `checkpoint` uses a
precondition against the previously read/checkpointed value. A concurrent
durable writer causes a conflict rather than an overwrite. Finalized writer IDs
reject late updates; duplicates are ignored and sequence gaps fail explicitly. A
projection supports at most 16 Mi UTF-16 code units. The registry retains ended
writer IDs for its graph's lifetime; it currently has no tombstone compaction.

## Queries and storage

This is a **display projection**, not a second query engine. `graph.read()`
selects membership, ordering, limits, and derived values from durable storage,
then substitutes live text in the result. `graph.storage`, transaction reads,
aggregates, and predicate evaluation remain durable. In particular, a text
search will not find newly appended transient words until checkpoint/commit.
Consumers must not treat the live text as durable evidence for an operation.

Only existing text properties are supported. This API is for trusted application
code; it is not an unauthenticated mutation endpoint. Admission, authorization,
and entity creation still use the graph's normal durable APIs. No graph effects
run on transient notifications. Subscriptions must authorize the durable entity
before receiving its live projection.

`@yaks/api` subscriptions carry ordered `transient` frames to current members,
including live snapshots at subscription time. `@yaks/sync.land` applies those
frames without persisting their text. `@yaks/client` watches notify existing
members through the same query subscription API. Appends are microtask-batched
for delivery and send only new text, not each accumulated string. A final
durable frame precedes its end frame. This requires ordered delivery; gaps are
errors, not silently repaired. There is no automatic cross-connection replay
service.

Only one writer may own a property at a time. The caller must serialize durable
finalization with its writer. `forget(ids)` is for a replica dropping cached
entities, not for ending a remote writer. A new subscription can reinstall a
snapshot. Backend termination loses uncheckpointed projections by design.
