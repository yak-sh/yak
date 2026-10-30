---
name: search-and-embeddings
description: >
  Use for full-text search, .near, embeddings, vectors, similarity,
  neighbours, recall, ranking, search/embed vocabulary flags, embedder
  configuration and re-embedding, or missing/slow results. Covers @yaks/fts
  and @yaks/embedding locally and on yaks.app. Query syntax is
  query-grammar.
---

# Search

Search is how people find what they already said: the task they filed last
week, the memory that answers today's question, the duplicate about to be
filed. The graph finds things two ways, by words and by meaning, and both read
one list of what is searchable. The persona's invariant (M-17876, "Search is a
text predicate") is the contract; this is how it works and what we've learned.

The posture here is an experimenter's. Every choice in this corner, which
model, how wide, where the floor sits, has a number behind it, measured on our
own data on the machine that serves it. Intuition about embeddings is cheap and
often wrong; a benchmark run is nearly as cheap, and it tells you. What we're
proud of is a change that came with its table. What makes us wince is a model
swapped because it sounded faster, or a threshold carried from one model to
another.

## Two kinds of search

- **Words:** a bare word in any query is a text match over @yaks/fts's FTS5
  indexes, one index per component (packages/fts/README.md). Words match by
  prefix, unstemmed; `bm25` ranks (lower is better), below one tier: a hit
  whose stored text is exactly the words (a title that is the name searched)
  comes first. `.order=search` orders by it, and so does a window (`.limit`,
  `.after`) of any query with words that states no other order. Hits carry a computed `rank` and snippets marked
  `\x01…\x02`, never HTML.
- **Meaning:** `.near=<entity>` ranks entities by cosine similarity of stored
  vectors to that entity's vector, among whatever the rest of the query admits;
  `.order=similar` orders by it (packages/embedding/README.md, "How `.near`
  compiles"). A target with no vector yet selects nothing.

How either is written in a query is `query-grammar`'s; how the archetype index
answers the rest of the query is `graph-reads-and-writes`'.

## What is searchable

Whether a component is searchable is a vocabulary decision (`vocabulary`), and
these are the words for it:

- `search: true` on a string property indexes it for words and embeds it for
  meaning. A component's `search` list names text it is found by on another
  component: `entry` is found by `content.body`, so tool results wearing
  `content` are not. What a bare word finds, `.near` finds too.
- `embed: false` on a component keeps its entities out of the vectors while
  they stay findable by words: tool results (`result`, packages/tools) and
  drafts. Text nobody looks up by meaning costs vectors, index time and lookup
  time for nothing.
- Vectors are derived data: per store, never synced, never backed up, rebuilt
  from the text. So the box and a yaks.app store may use different models.

## The tools

- **@yaks/fts**: `fields(vocab)` picks the text, `heal()` rebuilds an index
  that disagrees with its rows, `adopt()` brings an existing database into the
  generated layout (packages/fts/README.md, "Maintaining existing indexes").
- **@yaks/embedding's embedders** ("The embedder is yours"): `remote()` for
  Ollama or any OpenAI-compatible endpoint, `workersAi()` for a Worker's `AI`
  binding, an in-process Model2Vec model (@yaks/model2vec), and `hashEmbedder()`
  for a test that needs vectors without a model.
- **`vector_check`** says whether the box's index is built and current,
  and names the cases where every search reads every vector.
- **The benchmark**: duplicate-task MRR and comment-to-task MRR, with the
  tables, in T-45558's and T-59058's comments. It's what a candidate model is
  run through.

## On the box

- **Provider and model are rows**, the way chat models are (M-36709):
  `provider{name, base, api}` with a `serves{name}` edge to a `model{name}` row
  (@yaks/model). ~/.yak/yak.json's `@yaks/embedding` entry names the provider
  and the model, so switching either is a write, not a release. Today:
  provider `ollama.yak.sh`, model `granite-embedding-30m-english`, 384 wide,
  on the GPU's Ollama container.
- **The sweep:** triggers queue every written entity in `embedding_owed`, and
  the plugin's service drains it in batches (packages/embedding/README.md,
  "The sweep"). Writes never wait on embedding.
- **The index:** sqlite-vector keeps 2-bit codes; a search scans them for
  candidates and ranks those by exact cosine ("The index").
- **Neighbours on write:** a tool call that creates a task, memory or comment
  answers its three nearest of the same kind ("A write answers what it is
  near"). The doc view's similar-task twins cut at `FLOOR` in
  packages/browse/twin.ts.

## In yaks.app stores

- A Durable Object can't load sqlite-vector, so workers/yak/embedding.ts embeds
  through Workers AI (Qwen3-Embedding, full 1024 wide), keeps float32 in the
  store's SQLite, and holds the vectors as int8 in the object's memory
  (packages/embedding/held.ts). A search scans the int8 copy and ranks the best
  `RESCORE` (100) by their float rows: the scan alone finds ~99.4% of the exact
  top 8, the re-scored answer all of them. Copies share `HELD` (48 MB) per
  isolate; past it a store reads every row.
- The store drains its sweep after each commit and from its alarm, behind its
  own traffic. Workers AI out past the embedder's retries is an outage the
  drains ride out, logged, with the texts still owed; only texts waiting past
  `OVERDUE` (15 minutes) report, once (packages/embedding/outage.ts). The
  store itself is `yaks-app`'s.

## Words ranked by meaning

A host ranks words by meaning through `host.meaning` (@yaks/host): words and
a filter line in, the entities nearest them among what the line admits out. On
the box @yaks/embedding's graph facet offers it; a yaks.app store lends its
own over Workers AI (workers/yak/graph.ts). Memory recall is its consumer
(@yaks/memory `memory_recall`): `said` ranks a space's memories by meaning,
and the store then reads the ones it names, so the ranking never decides what
a caller may read. The `search` tool merges it with full-text hits.

## What we've learned

- **Lookup cost matters more than embedding cost.** The owner, verbatim
  (T-59058): "i care more about indexed embedding lookup than i do how long the
  embedding itself takes." A vector is made once and searched every time. So
  the number to measure is the indexed `.near` at the live vector count, on the
  server. On the box a request to Ollama costs 40–80 ms whatever the model, so
  a small model buys little embed time; width is what moves lookup time.
- **Provider and model are two choices.** The owner, verbatim (T-59058): "two
  different things: using ollama (or any provider; build it generically), and
  then which model the provider uses." Which server answers is data; which
  model it runs is measured. A problem with one is fixed in that one.
- **Quality is a number.** A switch to a faster model once dropped
  duplicate-finding MRR from .843 to .711, and the owner asked for the remote
  model back (T-59058). Any candidate goes through the same benchmark.
- **Keep the width; quantize instead of cutting.** Cutting a vector's
  dimensions loses quality nothing recovers; int8 loses less, and re-scoring
  the top candidates from float wins it back (T-61474, with sources).
- **A similarity floor belongs to its model's space.** A threshold measured on
  one model means something else on another, so a new model means measuring
  the floor again (twin.ts says how it was measured).
- **Changing the model or width is a migration** (`data-migration`). Every
  vector is made again. On the box, while two models share the table no index
  is built and every search reads every vector; in a store, `.near` answers
  only from what is done until the sweep finishes. Back up ~/.yak/yak.json
  first and prove it on a `bin/copy-db` copy.
- **A page of a search reads a page.** A store bills each row a cursor hands
  back, not FTS5's own reads, so `order by rank limit N` inside the index
  costs about N where materializing every hit's bm25 costs every hit. Ranking
  all matches for a 2-row window took a broad fixture search from 18,027 rows
  to 51,075; ranking each index's best N and reading only those took it to
  2,073 (T-131858). Check ranking decisions through the in-process search
  interface; observe billing from the live platform after deployment.
- **Open:** 1-bit codes for the box's scan (T-59519), `.near` on D1 (T-59333),
  embedding calls spending from an account's budget (T-59279).

When this skill is wrong or missing something, fix it in the same change.
