# @yaks/memory

Marks what a person said, in their own words, where the graph already holds it,
reads it back at the start of the next conversation, and reads around it. It
also declares what is built from those words: `belief`, a conclusion a builder
drew from memories, and `topic`, a subject beliefs are about. This package
supplies the components, the write and read helpers, and nine tools; storage and
optional semantic ranking come from elsewhere.

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

A memory is a mark on the entity holding the words: a session entry, a comment,
a doc. The words are that entity's own text, and nothing here edits them:

```json
{
  "entity": { "eid": "e1" },
  "entry": { "session": "s1", "seq": 12 },
  "content": { "body": "use grams, never cups" },
  "memory": { "context": "the recipe app", "at": "…", "by": "a1", "via": "s1" }
}
```

Words the graph holds nowhere yet (said in a chat, say) get a doc of their own,
whose `doc.body` is the sentence verbatim; on yaks.app that is most of them.
`words(bundle)` reads the words from whichever component holds them, a doc's
body, else a transcript entry's content, else a doc's title (a task filed as one
line), so a memory renders and is found the same way whatever it marks. `memory`
holds the rest:

- `space` — the space the statement belongs to. Deleting the space deletes its
  memories. Space membership and read access require application access
  controls; this schema alone does not enforce them.
- `scope` — an optional project reference; the memory survives project deletion.
- `last_confirmed_at` — a stamped timestamp for the latest confirmation.
- `at`, `by`, `via` — who marked the words, when, and through what. They make
  `memory` a mark in @yaks/graph's sense: stamped the first time the component
  is written, and left alone after. Nothing needs approving.
- `feedback{by}` — a separate component marking a correction and, when known,
  the entity identifying the person who supplied it.
- `about` — the app it was about, by slug, when it was about one.
- `context` — the line or two needed to understand the words. Never a
  restatement of them.

Who said the words, and when, is the entity's own `created{at, by}`. A mark says
what happened to an entity, never what it is: a comment marked as a memory is
still a comment, and only a doc that is nothing but a memory is shown as one
(@yaks/vocab `kindOrder`).

## Beliefs and topics

A memory is what happened; a belief is what was built from it. A belief is a
builder's output ([@yaks/builders](../builders)): `doc{title, body}` says it,
`built` names the build that made it, `cites` edges name the memories or beliefs
it was built from, and `belief` says where it stands:

- `about` — its subject: a topic, a project, a package, a component (`_comp`) or
  a design.
- `scope` — the project it holds for; absent for a principle that holds
  everywhere.

Nobody edits a belief. A wrong one is fixed in the builder that made it, and the
builder makes it again.

A topic is a subject no project, package, component or design already is:
`topic{name}` beside a `doc` whose title names it and whose body is a brief, a
line or two saying what belongs under it. What is understood about the subject
lives in the beliefs about it, not in the brief. `topic.name` is the title in
lowercase with single spaces, and it is the topic's identity: its id is derived
from it (`topicEid(title)`), so a name said twice is one topic, whoever says it
and however they capitalise it. That is the guard against synonyms from the
graph's side; the other is that a builder finds the topics that exist before it
makes one.

## Writing

`marked()` returns the bundle that marks an entity already holding the words:
`memory` and, for a correction, `feedback`, nothing about the words. `saved()`
returns the bundle for words the graph holds nowhere: a doc whose body is `said`
trimmed, marked the same way; it rejects an empty `said`. Both keep context as
at most `LINES` (two) trimmed, non-blank lines. The caller passes the list to
`g.apply()`.

## Reading

`line()` builds the query string that finds memories, in the filter grammar
understood by yaks storage adapters. With `said`, it adds search terms as a
filter; without `near` or explicit ids, the newest words come first (descending
`created.at`). Every component comes back, since the words may be a doc's body
or an entry's content. Search terms do not request BM25 ranking. A `.near` query
requires a configured embedding index.

`Ranker` is the interface for an application-supplied semantic search function:

```ts
import type { Eid } from '@yaks/graph'

type Ranker = (
  words: string,
  scope: { space: Eid; limit: number },
) => Promise<Eid[]>
```

It returns semantically similar memory ids, closest first, and `ordered()`
reorders the store's result to match. Nothing here knows how that is done: on
yaks.app it is the store's own vectors, embedded by Workers AI and ranked by
[@yaks/embedding](https://jsr.io/@yaks/embedding), and without a ranker the
query filters by words and sorts by entity number. The library does not
automatically call a ranker; the application does.

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

`vocab.json` declares nine tools, and `@yaks/memory/tools` exports the `runs()`
factory that implements them (`yak memory save`, `yak memory recall`, and the
rest the same way, and each over `/mcp`):

```sh
yak memory save 'always commit your changes' --scope P-19 --feedback jeff
yak memory save --on C-38041 --context 'on the persona gates'
yak memory recall 'commit'
yak memory recall --near T-37666
yak memory source 'always commit your changes' --by jeff
yak memory around '#c625160bfa' -B 5 -A 2
yak memory target C-38041
yak memory thread C-38041
yak memory session '#c625160bfa'
yak topic find --near '#c625160bfa'
yak topic new testing --body 'what a test checks, and how fast a suite runs'
```

`memory save` marks the words where the graph holds them: the entity `on` names,
or, given `said` and a `feedback` naming who said them, the earliest entity that
person wrote whose text holds those words verbatim. The same words in anybody
else's text are a quote, so words it cannot place become a new doc. Passing `id`
patches an existing memory instead, leaving alone whatever the call did not
mention. Replacing the words requires `was` — the token `memory recall` returns
beside them, which the graph's own precondition check reads — so a memory
another writer changed since you read it is rejected as a whole rather than
overwritten; the words of anything a memory marks (a comment, an entry, a task)
are what happened there and are never replaced.

`memory recall` returns complete memories, not excerpts. `said` is converted to
search terms, so use words expected in the stored statement, not a new question
about it. Those terms are filters, not a guaranteed exact phrase or a relevance
ranking. `near` names an existing entity for semantic ranking when
[@yaks/embedding](https://jsr.io/@yaks/embedding) is configured. Without that
ranking or explicit ids, the newest words come first.

`memory source` answers where a person said words: the earliest entity they
wrote holding them verbatim, the same entity a save given `said` and `feedback`
marks, or a refusal where there is none. A model finding the source of a quote
marks it with `on`, and never makes a doc for words it could not place.

The other four read around a memory, the way `grep -C` reads around a line, for
a model building beliefs from memories. Each takes any entity and answers
bundles, each whole:

| Tool             | Answers                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `memory_around`  | the transcript entries around an entry: `before` ahead, the entry, `after` behind (default 3 each) |
| `memory_target`  | what it is aimed at: the entity each of its components' `target` names (a comment's, a letter's)   |
| `memory_thread`  | what its comments are about, past every reply, then every comment below that, oldest first         |
| `memory_session` | the session it was written in, then what that session worked on (`worked` edges) or claims         |

They know other packages' components (`entry`, `comment`, `worked`, `claim`)
only by the names their queries speak and the rows those answer.

`topic find` answers topics whole: those whose name or brief holds a word
starting with each word of `said` (`query` finds `querying`), ranked by meaning
to `near` where the server has embeddings, or with neither, in order of name.
`topic new` makes a topic from a name and a brief, and refuses a name that is
taken, or whose words hold another topic's or are held by them (`overlaps`:
"economic market design" beside "market design"), saying which topic to use. A
builder making beliefs finds before it makes, so a subject already named is
reused, and the refusal catches two builds that found nothing at once.

## Exports

The root exports `memoryDoc`, `marked`, `saved`, `clamped`, `words`, `terms`,
`line`, `heard`, `ordered`, `passage`, `named`, `topicEid`, `found`, `overlaps`,
the `Marking`, `Saving`, `Asked`, `Memory`, and `Ranker` types, and constants
`MEMORY`, `FEEDBACK`, `LINES`, `EMPTY`, `LAST`, `BYTES`, `TOPIC` and `FIND`.
`named` folds a title to a topic's name, `topicEid` gives the id a title names,
and `found` builds the query `topic find` reads. `clamped` performs context-line
trimming; `terms` turns words into search terms the query grammar cannot
misread; `EMPTY` is the empty-statement error message. `@yaks/memory/vocab`
exports `memoryDoc` and its `docs` array for schema loaders;
`@yaks/memory/tools` supplies the tool implementations described above.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno`, no Node built-in, no
DOM global beyond `TextEncoder` — and type-checks under
`lib: ["dom", "esnext"]`, so it runs unchanged in a **browser**, on **Deno**,
and on **Node** (via JSR / npm). The library depends on sibling schema and graph
libraries. The optional `./tools` implementations additionally require the
configured graph and, for search queries, the appropriate search extensions.

## License

Apache-2.0
