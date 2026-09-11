# @yaks/archetype

One entity per set of component **tables**, shared by every entity wearing that
set. Its eid is `derivedEid('archetype|' + canonicalNames.join(','))`: the
shared graph derivation (SHA-256 worn as a version-8 UUID), with names sorted
bytewise by UTF-8. This is disjoint from blobs' full SHA-256 hex addresses;
`archetype.tables` stores the sorted list as a JSON string, the vocabulary's
scalar JSON representation. Empty sets are valid. Duplicates collapse. Names
containing `,`, `|` or NUL are refused rather than producing ambiguous hashes.

```ts
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'

// let vocab = loadVocab([archetypeDoc, ...yourDocuments])
// let store = storage(driver, vocab)
// store.install()
// let g = graph({ storage: store, vocab, plugins: [archetypes()] })
// g.apply([{ entity: { eid: 'note' }, doc: { title: 'Hello' } }])
```

Both vocabulary and plugin are opt-in. `entity.archetype` rides bundles as an
eid; SQLite keeps the corresponding indexed integer spine id. A caller's
supplied pointer is ignored by the plugin. `Archetypes` interns immutable sets,
caches `(from, +/-table) → to` transitions, and caches `matching({all, none})`
answers. `satisfies` evaluates the same presence predicate against one set.
Learning a new set invalidates the predicate cache. No query grammar or SQL
lowering lives here.

## Writes and boot

The graph's transaction-local `track` seam sees every write, including stamps,
reference-only births, cascades and journal writes. It starts from the gathered
pre-image, loads a missing descriptor once per process, and edits its table set
without rereading component tables. This preserves tables the writer's
vocabulary does not know. Value-only patches and net-zero changes do not move
the pointer.

Pending moves flush before the journal; new descriptors join the journal's
batch. A second flush classifies writes made by journal/commit hooks without
recursively journaling the journal. Normally an owner gets one integer update
per batch; a commit hook that changes its shape again necessarily causes another
move. Descriptor entities are not provenance-stamped by this mechanism: their
ordinary set is `['archetype']`, whose descriptor points to itself. They may
wear `retired`.

Caches contain content, **never** a claim that a row committed. Each transaction
checks the needed descriptor identities, mints only missing ones, and writes the
pointer in that same transaction. Dry runs, late refusals, and enclosing
rollback cannot leave cache entries pointing at nonexistent database rows.

`@yaks/sqlite` installs the integer column/index additively. When archetypeDoc
is loaded, install also runs `backfill`: table-sized presence scans over
incomplete owners, discovering actual component tables through SQLite's schema
(including unknown-vocabulary tables), not through `vocab.all`.
Virtual/shadow/infrastructure tables are excluded. Tombstones and archetype
entities are classified too. Missing-table descriptors are marked `retired`,
never deleted, and their owners are reclassified. Repeated boot is idempotent.
Legacy bare-SHA descriptors are renamed atomically at boot, preserving spine
ids, integer references, tables and retirement marks. An occupied destination is
refused without partial migration. Legacy descriptors carrying extra facets
(beyond `archetype` and `retired`) also refuse migration: a shared
blob/descriptor cannot be renamed without stealing the blob address, and its
references require disambiguation first. External copies of legacy eids must
reload the descriptors; legacy ids are not accepted on new writes. Boot is a
storage migration rather than a graph apply; graph-time descriptor creations are
journaled when the journal plugin is composed in.

Use `g.apply()` for ongoing writes; low-level storage patch is intentionally
still a byte-writing primitive. A later boot catches its unclassified births,
not an arbitrary out-of-band rewrite of an already-classified entity. Arbitrary
SQL and component-table drops require reopening/installing before graph writes
resume.

## Compatibility

The package uses only portable TypeScript and web APIs: Deno, Node, browsers and
Workers. `browser.json` checks the shipped code without Deno/Node globals.
SQLite and RAM support the pointer; remote adapters must implement that storage
metadata before composing in this plugin. The benchmarks run in-memory and
file-backed SQLite over the repository's shared deterministic workload and join
`bench:check`.
