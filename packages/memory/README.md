# @yaks/memory

Stores what a person said, in their own words, as graph entities, and reads them
back at the start of the next conversation. This package supplies the `memory`
component, the write and read helpers, and two tools; storage and optional
semantic ranking come from elsewhere.

An entity is a record identified by `entity.eid`. A bundle is a JSON object
containing that identifier and the entity's named components, such as `doc` and
`memory`. The graph and its storage adapter persist these objects; this package
constructs writes, queries and display text.

## Install

```sh
deno add jsr:@yaks/memory
# or: npx jsr add @yaks/memory
```

## Use

```ts
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { memoryDoc, saved } from '@yaks/memory'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'

const vocab = loadVocab([docDoc, memoryDoc])
const g = graph({ vocab, storage: ram(vocab) })

await g.apply(saved({
  eid: crypto.randomUUID(),
  said: 'use grams, never cups',
  about: 'recipes',
  context: 'looking at the recipe app',
}))

console.log(await g.read('.memory ?doc'))
// For persistent storage, replace ram with a database adapter. For full-text
// queries, configure @yaks/fts on a compatible SQL adapter.
```

## The component

```json
{
  "entity": { "eid": "m1" },
  "doc": { "body": "use grams, never cups" },
  "memory": { "space": "s1", "about": "recipes", "context": "the recipe app" }
}
```

The text is `doc.body`, verbatim. That is where a store's search index lives, so
a memory is findable through the same API as every other text and renders
through the same renderer. `memory` holds the rest:

- `space` — the space the statement belongs to. Deleting the space deletes its
  memories. Space membership and read access require application access
  controls; this schema alone does not enforce them.
- `scope` — an optional project reference; the memory survives project deletion.
- `last_confirmed_at` — a stamped timestamp for the latest confirmation.
- `feedback{by}` — a separate component marking a correction and, when known,
  the entity identifying the person who supplied it.
- `about` — the app it was about, by slug, when it was about one.
- `context` — the line or two needed to understand the words. Never a
  restatement of them.

The graph's optional `created{at, by}` component records when the record was
created and the writer's identity. It identifies the speaker only when the
application writes as that speaker; `feedback.by` can identify a different
person who supplied a correction.

## Writing

`saved()` trims `said` and rejects an empty result. It keeps the statement
rather than summarizing it. It drops blank context lines, trims each remaining
line, and keeps at most `LINES` (two). It returns a list containing one bundle;
the caller passes that list to `g.apply()`.

## Reading

`line()` builds the query string that finds memories, in the filter grammar
understood by yaks storage adapters. With `said`, it adds search terms as a
filter; without `near` or explicit ids, it orders by descending `entity.num`.
This requires numbered entities for creation-order sorting. Search terms do not
request BM25 ranking. A `.near` query requires a configured embedding index.

`Ranker` is the interface for an application-supplied semantic search function:

```ts
type Ranker = (
  words: string,
  scope: { space: Eid; limit: number },
) => Promise<Eid[]>
```

It returns semantically similar memory ids, closest first, and `ordered()`
reorders the store's result to match. Nothing here knows how that is done: on
Cloudflare it is Vectorize with an embedding from Workers AI, on a server it
could be [@yaks/embedding](https://jsr.io/@yaks/embedding) over SQLite, and
without a ranker the query filters by words and sorts by entity number. The
library does not automatically call a ranker; the application does.

An external vector index must use the same dimensions and similarity metric as
the embedding model. Creating and updating that index is the server's
responsibility.

## The passage

`passage({ name, space }, memories)` builds the text an agent is given at the
start of a conversation. Pass `Memory` records in the desired order; use
`heard(bundle)` to convert graph results and `ordered(ids, memories)` to apply
an external ranking. Each statement is quoted in full with its context below.
The helper includes at most `LAST` (8) records and targets `BYTES` (2048) UTF-8
bytes of record text. The first record is always included even if oversized, and
the heading and omitted-results notice are additional bytes. This is not a
strict total-output bound. If records are omitted, a notice names
`memory_recall`, so the application should expose that tool.

## The tools

`vocab.json` declares two tools, and `@yaks/memory/tools` exports the `runs()`
factory that implements them (`yak memory save`, `yak memory recall`, and the
same two over `/mcp`):

```sh
yak memory save 'always commit your changes' --scope P-19 --feedback jeff
yak memory recall 'commit'
yak memory recall --near T-37666
```

`memory save` creates a memory from the words given; passing `id` patches an
existing one instead, leaving alone whatever the call did not mention. Replacing
the words requires `was` — the token `memory recall` returns beside them, which
the graph's own precondition check reads — so a memory another writer changed
since you read it is rejected as a whole rather than overwritten.

`memory recall` returns complete memories, not excerpts. `said` is converted to
search terms, so use words expected in the stored statement, not a new question
about it. Those terms are filters, not a guaranteed exact phrase or a relevance
ranking. `near` names an existing entity for semantic ranking when
[@yaks/embedding](https://jsr.io/@yaks/embedding) is configured. Without that
ranking or explicit ids, the query sorts by descending entity number.

## Exports

The root exports `memoryDoc`, `saved`, `clamped`, `line`, `heard`, `ordered`,
`passage`, the `Saving`, `Asked`, `Memory`, and `Ranker` types, and constants
`MEMORY`, `FEEDBACK`, `LINES`, `EMPTY`, `LAST`, and `BYTES`. `clamped` performs
context-line trimming; `EMPTY` is the empty-statement error message.
`@yaks/memory/vocab` exports `memoryDoc` and its `docs` array for schema
loaders; `@yaks/memory/tools` supplies the tool implementations described above.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno`, no Node built-in, no
DOM global beyond `TextEncoder` — and type-checks under
`lib: ["dom", "esnext"]`, so it runs unchanged in a **browser**, on **Deno**,
and on **Node** (via JSR / npm). The library depends on sibling schema and graph
libraries. The optional `./tools` implementations additionally require the
configured graph and, for search queries, the appropriate search extensions.

## License

Apache-2.0
