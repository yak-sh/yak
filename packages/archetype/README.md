# @yaks/archetype

Tracks which component tables contain each entity, so presence queries and
component additions/removals can reuse cached sets. An entity is a record
identified by `entity.eid`; each named component is stored in a corresponding
table by SQL adapters. An **archetype** is the record describing one distinct
set of those table names, shared by all entities with that set.

## Stored data

An archetype's eid is `derivedEid('archetype|' + canonicalNames.join(','))`: the
shared graph derivation (a SHA-256 encoded as a version-8 UUID), with names
sorted bytewise by UTF-8. This is disjoint from blobs' full SHA-256 hex
addresses; `archetype.tables` stores the sorted list as a JSON string, the
vocabulary's scalar JSON representation. Empty sets are valid. Duplicates
collapse. Names containing `,`, `|` or NUL are rejected rather than producing
ambiguous hashes.

```ts
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'

const vocab = loadVocab([archetypeDoc, docDoc])
const g = graph({ storage: ram(vocab), vocab, plugins: [archetypes()] })
await g.install()
await g.apply([{ entity: { eid: 'note' }, doc: { title: 'Hello' } }])
console.log(await g.read('.doc'))
```

The example uses RAM; use [@yaks/sqlite](../sqlite) for persistent storage. The
root module exports `archetypeDoc`, `archetypes()`, `Archetypes`, `canonical`,
`eidOf`, `tablesOf`, `satisfies`, and the `Archetype` type. `./vocab` and
`./rules` provide the declarations and plugin factory for loaders.

Both the vocabulary and the plugin are opt-in. A bundle is one entity's
components as a JSON object. `entity.archetype` appears in bundles as an eid;
SQLite stores the corresponding indexed integer entity id. A caller's supplied
pointer is ignored by the plugin. `Archetypes` interns immutable sets, caches
`(from, +/-table) → to` transitions, and caches the results of
`matching({all, none})`. `satisfies` evaluates the same presence predicate
against a single set. Learning a new set invalidates the predicate cache. No
query grammar or SQL lowering lives here.

## Writes and startup

The graph's transaction-local `track` callback sees every write, including
stamped columns, entities created only to be referenced, cascading deletes and
journal writes. It starts from the entity's state before the transaction, loads
an uncached archetype record once per process, and updates its table set without
rereading component tables. This preserves tables the writer's vocabulary does
not know. Value-only patches and net-zero changes do not move the pointer.

Pending archetype assignments are written before the journal; new archetype
records are included in the journal's batch (a list of changes applied in one
transaction). A second flush classifies writes made by journal/commit hooks
without recursively journaling the journal. Normally an entity gets one integer
update per transaction; a commit hook that changes its component set again
necessarily causes another move. Descriptor entities are not provenance-stamped
by this mechanism: their ordinary set is `['archetype']`, whose descriptor
points at itself. They may carry `retired`.

Caches contain content, **never** a claim that a row committed. Each transaction
checks the required archetype identities, creates only missing records, and
writes the pointer in that same transaction. Dry runs, late refusals, and
enclosing rollback cannot leave cache entries pointing at nonexistent database
rows.

`@yaks/sqlite` installs the integer column/index additively. When archetypeDoc
is loaded, install also runs `backfill`: table-sized presence scans over
incomplete owners, discovering actual component tables through SQLite's schema
(including unknown-vocabulary tables), not through `vocab.all`.
Virtual/shadow/infrastructure tables are excluded. Deleted entities whose ids
remain reserved (tombstones), and archetype entities are classified too.
Missing-table descriptors are marked `retired`, never deleted, and their owners
are reclassified. Repeated startup is idempotent. Legacy bare-SHA descriptors
are renamed atomically at startup, preserving internal integer entity ids,
integer references, tables and retirement marks. An occupied destination is
rejected, with no partial migration. Legacy descriptors carrying components
beyond `archetype` and `retired` also refuse migration: a shared blob/descriptor
cannot be renamed without stealing the blob address, and its references require
disambiguation first. External copies of legacy eids must reload the
descriptors; legacy ids are not accepted on new writes. Startup backfilling is a
storage migration rather than a graph apply; graph-time descriptor creations are
journaled when the journal plugin is composed in.

Use `g.apply()` for ongoing writes. Low-level storage `patch` bypasses this
plugin. A later install classifies newly created entities lacking an archetype,
but does not detect arbitrary direct changes to already-classified entities. An
application that must write a component row outside the graph calls
`@yaks/sqlite`'s `reclassify(driver, eids)` in that same transaction; there is
no trigger or queue to maintain. Arbitrary SQL and component-table drops require
reopening/installing before graph writes resume.

## Compatibility

The package uses only portable TypeScript and web APIs: Deno, Node, browsers and
Workers. `browser.json` checks the shipped code without Deno/Node globals.
SQLite and RAM support the pointer; remote adapters must implement that storage
metadata before composing in this plugin. The benchmarks run in-memory and
file-backed SQLite over the repository's shared deterministic workload and join
`bench:check`.
