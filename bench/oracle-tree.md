# Oracle tree experiments

An **oracle tree** is retained evidence-grown nodes, each with a parent-assigned
domain, its own routing advertisement, its own context and context shared with
its children. `@yaks/oracle` owns growth and conversations; `context-reading.ts`
exposes the tree to a measured historical caller.

## Prepare separately from answering

`measuredTree({ rows, cutoff, model, limits })` prepares a tree offline. Save
`evidence().root` and `evidence().nodes` as `oracleTree.resume` in the private
candidate packet. Keep construction calls and failed attempts in the cost
ledger. Answer runs require that retained tree: construction is not a query
step. `maxNodes` is a ceiling, not a reason to reject a useful smaller tree or
manufacture padding. The ready root is sufficient to serve queries.

The packet's evidence must precede every historical cutoff. Trees at different
historical cutoffs must not share later evidence. Reuse a tree only when its
admitted evidence is valid for that question; do not silently filter a retained
tree into a different historical experiment.

For example, after preparing and retaining a private packet:

```sh
deno run -A bench/context-reading.ts --packet /private/retained-packet.json \
  --out /private/answers.json --native
```

The packet's `oracleTree` contains `rows`, `limits` and `tree`, the graph entity
id of the retained tree. `rows` and every revision's evidence IDs must agree.
`run` refuses a packet without `tree` rather than rebuilding for each case.
`measuredTree({ graph, tree, prepare: true, ... })` prepares offline; subsequent
runs load the tree and frozen evidence from that graph.

## Answer with a bounded conversation

`tree.query({ message })` opens a receiving fork. Its returned conversation
handle continues that fork. `tree.question()` returns a query function with one
shared call budget across caller follow-ups and all descendant conversations.
The measured `ask_oracle` tool uses one such function per original question.

`limits.queryCalls` defaults to six model calls across routing, evidence reads,
answers and decline reviews, not six at every node. Waiting ancestors retain an
answer call. At the end of the budget the model receives no tools and must
answer from retained context, including uncertainty; a model that still calls a
tool fails explicitly. Errors and attempted calls stay in the trace. Routing
cannot revisit an active node or send the question straight back to its sender.

Ordinary questions cannot branch or revise the tree. Offline structural work
uses `tree.query({ message, maintenance: true })`; the measured caller cannot
set this flag. Structural work retains the same conversational channel and is
accounted for separately from answering. Small assigned evidence sets are
included in the initial growth request so publishing a leaf does not require
re-reading each row through another model turn.

`stats().growthCalls` and `stats().answerCalls` separate construction from other
calls. The trace retains exact roles and requests; candidate calls are recorded
by the caller, not again by the tree. A bound is not a quality result: grade
answers against held-out evidence and report construction, query cost, retries,
usage and wall time separately. A rubric with nineteen points is not nineteen
independent questions.

## Query-grown topic workload

The historical `context-reading.ts` workload measures interpretation of past
owner messages. Its results do not establish topic-oracle answer quality,
research, useful organization or growth in response to questions.

`topic-oracle.ts` measures a sequence against the native `oracle_query` tool.
Start an isolated graph with only one root `topic{name}`. Existing `about` edges
point from child topics to broader parent topics. `oracle_read` supplies the
topic and its retained directional context; the benchmark preserves that answer
whole. The receiving conversation pins context for itself and its direct
neighbors, without recursively expanding the graph. Place the research corpus in
that graph without prebuilding child oracles. `topicCorpus()` in
`topic-oracle-workload.ts` reads the graph and sync package READMEs, preserving
the exact source bytes as ordinary documents. `topicCases` supplies questions,
continuations, a repeated subject approached from a different use and an
unanswerable personal question. These are a small public workload, not the
owner's personal evidence.

Use `nativeTopics(graph, agent, actor)` with the configured native agent's
`send`, `idle` and `transcript` methods, then pass it as `host` to `runTopics`.
Supply `root`, `cases`, `mode` (`scripted` or `model`) and `save` to persist
each observation. `runTopics` refuses a prebuilt tree. It starts each
independent case at the root and continues follow-ups in the same receiving
fork. The ordinary native host owns model calls, research, tools and completion;
the benchmark implements no session loop or credentials.

Every turn retains its question, answer or failure, before/after topic, retained
context and edge rows, changed rows, receiving-fork transcripts, tool calls,
model request counts, reported usage/cost and wall time. Descendant work counts
once across the sequence after all receiving forks settle, including a parent
woken by a finishing child. Missing usage and cost stay unknown. Retain the
initial corpus, model selection, host configuration and code revision beside the
output when running an experiment.

`topic-oracle-rubric.ts` supplies external criteria and source references; never
add it to the research corpus or model context. Grade separately against the
source documents. Assess answer correctness and citations, uncertainty on the
unknown question, whether the structures are coherent single topics, whether
follow-ups retain their context, and whether the repeated subject reuses learned
context and a topic's identity rather than creating duplicate subjects. Check
that corrections update retained context for later receiving conversations while
existing conversations keep their opening context. Assess the self,
parent-facing and child-facing contexts separately, including one-hop inclusion
and two-hop exclusion. Inspect placement through the retained edges, including
any topic reached through multiple parents. Report growth/research and routing
work per question as well as totals. There is no required node count or exact
taxonomy, and creating nodes alone earns no quality credit.

A scripted-model test proves this measurement path and the native fork
mechanism. It says nothing about a model's answers, research or topic choices. A
model experiment remains a separately authorized, bounded manual run.
