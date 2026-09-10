# @yaks/memory

Graph vocabulary and helpers for storing, selecting, ranking, and formatting
memories. The host supplies persistence and can optionally supply semantic
ranking.

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

// getting them back — the words rank them, newest first without any
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
a memory is findable through the same API boundary as every other text and reads
back through the same renderer. `memory` says the rest:

- `space` — whose place it was said in. Every member of that space reads it, and
  it dies with the space.
- `about` — the app it was about, by slug, when it was about one.
- `context` — the line or two needed to understand the words. Never a
  restatement of them.

Authorship is the graph's own `created{at, by}`. Who said it and when are facts
every entity already carries; a second spelling here would drift from the first.

## Writing

`saved()` refuses an empty `said` — a memory with no sentence in it is an
agent's note about a conversation, which is the thing this package exists to not
be — and clamps `context` to `LINES` (two): enough to say what was being talked
about, not enough to restate what was said.

## Reading

`line()` is a filter line every yaks store answers. With words on it, the
store's own full-text index over `doc` ranks them; with none, newest first.

`Ranker` is the interface for a host that can do better than words:

```ts
type Ranker = (
  words: string,
  scope: { space: Eid; limit: number },
) => Promise<Eid[]>
```

— the memories nearest in MEANING, ids only and closest first, which `ordered()`
puts the store's answer back into. Nothing here knows how that is done: on
Cloudflare it is Vectorize with an embedding from Workers AI, on a server it
could be [@yaks/embedding](https://jsr.io/@yaks/embedding) over SQLite, and with
no ranker at all the words rank themselves. A host that binds none loses ranking
by meaning and nothing else.

An external vector index must use the same dimensions and similarity metric as
the embedding model. Creating and updating that index is the host's
responsibility.

## The passage

`passage({ name, space }, memories)` is what an agent is handed at the start of
a conversation: the newest few, whole and in quotes, with each one's context
under it. Bounded — `LAST` (8) of them and `BYTES` (2048) bytes, whichever runs
out first, then one line saying the rest are a `memory_recall` away. The host
must provide any recall tool referenced in the formatted output.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno`, no Node built-in, no
DOM global beyond `TextEncoder` — and type-checks under
`lib: ["dom", "esnext"]`, so it runs unchanged in a **browser**, on **Deno**,
and on **Node** (via JSR / npm). Its only dependencies are the sibling packages:
`@yaks/graph`'s bundle types and a `@yaks/vocab` schema.

## License

Apache-2.0
