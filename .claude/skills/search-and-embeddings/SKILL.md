---
name: search-and-embeddings
description: >
  How finding things works in the graph, on the box and in yaks.app stores:
  full-text search (@yaks/fts), embeddings and vectors (@yaks/embedding),
  `.near=<entity>` and `.order=similar` or `.order=search`, similar-task twins,
  memory recall, which embedding provider and model run, and what a lookup
  costs. Use it whenever a change or question touches search, `.near`,
  embeddings, vectors, similarity, neighbours, recall, ranking, `search: true`,
  `embed: false`, an embedder's config or model, or why something is or isn't
  found, even if the request only says "find", "related", "duplicates" or "slow
  query". How a query is written is `query-grammar`, how the archetype index
  answers one is `graph-reads-and-writes`; re-embedding stored vectors after a
  model change is still this skill.
scope: tasks-v2
volatility: stable
---

# Search

The graph finds things two ways, by words and by meaning, and both read one
list of what is searchable. The persona's invariant (M-17876, "Search is a text
predicate") is the contract; this is how it works and what has been learned.

## Two kinds of search

- **Words:** a bare word in any query is a text match over @yaks/fts's FTS5
  indexes, one index per component (packages/fts/README.md). Words match by
  prefix, unstemmed; `bm25` ranks (lower is better); `.order=search` orders by
  it. Hits carry a computed `rank` and snippets marked `\x01…\x02`, never HTML.
- **Meaning:** `.near=<entity>` ranks entities by cosine similarity of stored
  vectors to that entity's vector, among whatever the rest of the query admits;
  `.order=similar` orders by it (packages/embedding/README.md, "How `.near`
  compiles"). A target with no vector yet selects nothing.

## What is searchable

- `search: true` on a string property indexes it for words and embeds it for
  meaning. A component's `search` list names text it is found by on another
  component: `entry` is found by `content.body`, so tool results wearing
  `content` are not.
- `embed: false` on a component keeps its entities out of the vectors while
  they stay findable by words: tool results (`result`, packages/tools) and
  drafts. Embedding text nobody looks up by meaning costs vectors, index time
  and lookup time for nothing.
- Vectors are derived data: per store, never synced, never backed up, rebuilt
  from the text. So the box and a yaks.app store may use different models.

## On the box

- **Provider and model are rows**, the way chat models are (M-36709):
  `provider{name, base, api}` with a `serves{name}` edge to a `model{name}` row
  (@yaks/model). ~/.yak/yak.json's `@yaks/embedding` entry names the provider
  and the model; switching either is a write, never a release. Today:
  provider `ollama.yak.sh`, model `granite-embedding-30m-english`, 384 wide,
  on the GPU's Ollama container.
- **The sweep:** triggers queue every written entity in `embedding_owed`, and
  the plugin's service drains it in batches (packages/embedding/README.md,
  "The sweep"). Writes never wait on embedding.
- **The index:** sqlite-vector keeps 2-bit codes; a search scans them for
  candidates and ranks those by exact cosine ("The index"). `yak vector check`
  says whether it is built and current.
- **Neighbours on write:** a tool call that creates a task, memory or comment
  answers its three nearest of the same kind ("A write answers what it is
  near"). The doc view's similar-task twins cut at `FLOOR` in
  packages/web/twin.ts.

## In yaks.app stores

- A Durable Object can't load sqlite-vector, so workers/yak/embedding.ts embeds
  through Workers AI (Qwen3-Embedding, full 1024 wide), keeps float32 in the
  store's SQLite, and holds the vectors as int8 in the object's memory
  (packages/embedding/held.ts). A search scans the int8 copy and ranks the best
  `RESCORE` (100) by their float rows: the scan alone finds ~99.4% of the exact
  top 8, the re-scored answer all of them. Copies share `HELD` (48 MB) per
  isolate; past it a store reads every row.
- The store drains its sweep after each commit and from its alarm, behind its
  own traffic. Memory recall ranks a space's memories in the directory through
  the same `.near` (workers/yak/memory.ts, graph.ts `/meaning`).

## What has been learned

- **Lookup cost matters more than embedding cost** (Jeff, on T-59058). A
  vector is made once; it is searched every time. Measure the indexed `.near`
  at the live vector count, on the server, before choosing a model or width.
  On the box a request to Ollama costs 40–80 ms whatever the model, so a small
  model buys little embed time; width is what moves lookup time.
- **Provider and model are two choices.** Which server answers is data;
  which model it runs is measured. Never swap one to fix the other.
- **Quality is measured, not assumed.** A switch to a faster model once dropped
  duplicate-finding MRR from .843 to .711. T-45558's and T-59058's comments hold
  the benchmark (duplicate-task MRR, comment-to-task MRR) and the tables; run
  the same benchmark on any candidate.
- **Keep the width; quantize instead of cutting.** Cutting a vector's
  dimensions loses quality nothing recovers; int8 loses less, and re-scoring
  the top candidates from float wins it back (T-61474, with sources).
- **A similarity floor belongs to its model's space.** A threshold measured on
  one model means something else on another; changing the model means
  measuring the floor again (twin.ts says how it was measured).
- **Changing the model or width is a migration** (the `data-migration` skill).
  Every vector is made again; on the box, while two models share the table no
  index is built and every search reads every vector; in a store, `.near`
  answers only from what is done until the sweep finishes. Back up
  ~/.yak/yak.json first and prove it on a `VACUUM INTO` copy.
- **Open:** 1-bit codes for the box's scan (T-59519), `.near` on D1 (T-59333),
  embedding calls spending from an account's budget (T-59279).

When this skill is wrong or missing something, fix it in the same change.
