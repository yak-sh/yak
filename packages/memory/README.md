# @yaks/memory

Stores what a person said, in their own words, as graph entities, and reads them
back at the start of the next conversation. This package supplies the `memory`
component, the write and read helpers, and two tools; storage and optional
semantic ranking come from elsewhere.

Throughout this README, "the server" means whichever process opened the graph
and loaded this package — usually a long-running `yak serve`, sometimes just the
CLI.

## Install

```sh
deno add jsr:@yaks/memory
# or: npx jsr add @yaks/memory
```

## Use

```ts
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { line, memoryDoc, passage, saved } from '@yaks/memory'

let vocab = loadVocab([docDoc, memoryDoc, mine])

// keeping one
g.apply(saved({
  eid: crypto.randomUUID(),
  said: 'use grams, never cups',
  space: ada,
  about: 'recipes',
  context: 'looking at the recipe app',
}))

// getting them back — with words the full-text index ranks them, without
// words the newest come first
g.read(line({ space: ada, limit: 8, said: 'how do they like measurements' }))
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

- `space` — whose space it was said in. Every member of that space can read it,
  and it is deleted with the space.
- `about` — the app it was about, by slug, when it was about one.
- `context` — the line or two needed to understand the words. Never a
  restatement of them.

Authorship is the graph's own `created{at, by}`. Who said it and when are facts
every entity already carries; a second copy here would drift from the first.

## Writing

`saved()` rejects an empty `said` — a memory with no sentence in it is an
agent's note about a conversation, which is the thing this package exists to not
be — and truncates `context` to `LINES` (two) lines: enough to record what was
being talked about, not enough to restate what was said.

## Reading

`line()` builds the query string that finds memories, in the filter grammar
every yaks store answers. With words in it, the store's own full-text index over
`doc` ranks them; with none, the newest come first.

`Ranker` is the interface for a server that can do better than word matching:

```ts
type Ranker = (
  words: string,
  scope: { space: Eid; limit: number },
) => Promise<Eid[]>
```

It returns the memories nearest in MEANING, ids only and closest first, and
`ordered()` reorders the store's result to match. Nothing here knows how that is
done: on Cloudflare it is Vectorize with an embedding from Workers AI, on a
server it could be [@yaks/embedding](https://jsr.io/@yaks/embedding) over
SQLite, and with no ranker at all the word matching ranks them. A server that
binds none loses ranking by meaning and nothing else.

An external vector index must use the same dimensions and similarity metric as
the embedding model. Creating and updating that index is the server's
responsibility.

## The passage

`passage({ name, space }, memories)` builds the text an agent is given at the
start of a conversation: the newest few, whole and in quotes, with each one's
context under it. It is bounded — `LAST` (8) of them and `BYTES` (2048) bytes,
whichever runs out first, then one line saying the rest are a `memory_recall`
away. Whatever process formats the passage must also expose that recall tool.

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

`memory recall` returns memories WHOLE, ranked by whatever the server has: its
full-text index over `doc`, which matches `said` as a PHRASE, so use the words
you expect the memory to contain; its vectors where `near` names an anchor
entity and [@yaks/embedding](https://jsr.io/@yaks/embedding) is composed, which
is the ranking that answers a sentence; and the newest where it has neither.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno`, no Node built-in, no
DOM global beyond `TextEncoder` — and type-checks under
`lib: ["dom", "esnext"]`, so it runs unchanged in a **browser**, on **Deno**,
and on **Node** (via JSR / npm). Its only dependencies are the sibling packages:
`@yaks/graph`'s bundle types and a `@yaks/vocab` schema.

## License

Apache-2.0
