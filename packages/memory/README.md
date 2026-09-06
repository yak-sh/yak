# @yaks/memory

**What a person said, in their own words**: the `memory` component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph), plus the write that keeps a sentence
verbatim and the passage an agent reads at the start of the next conversation.

An agent that summarises what somebody told it can only ever remove information.
Everything the summary keeps was already in the sentence; anything it drops is
gone, and the agent after that works from a copy of a copy. So a memory here is
the sentence itself, with only the line or two of context somebody needs to read
it six weeks later.

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

The WORDS are `doc.body`, verbatim. That is where a store's search index lives,
so a memory is findable through the same door as every other text and reads back
through the same renderer. `memory` says the rest:

- `space` — whose place it was said in. Every member of that space reads it, and
  it dies with the space.
- `about` — the app it was about, by slug, when it was about one.
- `context` — the line or two needed to understand the words. Never a
  restatement of them.

The BYLINE is the graph's own `created{at, by}`. Who said it and when are facts
every entity already carries; a second spelling here would drift from the first.

## Writing

`saved()` refuses an empty `said` — a memory with no sentence in it is an
agent's note about a conversation, which is the thing this package exists to not
be — and clamps `context` to `LINES` (two): enough to say what was being talked
about, not enough to restate what was said.

## Reading

`line()` is a filter line every yaks store answers. With words on it, the
store's own full-text index over `doc` ranks them; with none, newest first.

`Ranker` is the seam for a host that can do better than words:

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

On Cloudflare the index is made once, outside the deploy:

```sh
wrangler vectorize create yak-memories --dimensions=768 --metric=cosine
```

768 is what `@cf/baai/bge-base-en-v1.5` answers with; a different model means a
different index.

## The passage

`passage({ name, space }, memories)` is what an agent is handed at the start of
a conversation: the newest few, whole and in quotes, with each one's context
under it. Bounded — `LAST` (8) of them and `BYTES` (2048) bytes, whichever runs
out first, then one line saying the rest are a `memory_recall` away. A person
who has said forty things is owed the last few at the top of every context and a
door to the others, not all forty.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno`, no Node built-in, no
DOM global beyond `TextEncoder` — and type-checks under
`lib: ["dom", "esnext"]`, so it runs unchanged in a **browser**, on **Deno**,
and on **Node** (via JSR / npm). Its only dependencies are the sibling packages:
`@yaks/graph`'s bundle types and a `@yaks/vocab` schema.

## License

Apache-2.0
