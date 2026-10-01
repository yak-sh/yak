---
name: platform-visualize
description: >
  Read the running platform's composed anatomy and bounded causal activity with
  @yaks/visualize, its /visualize page, agent tools and yak visualize command.
  Use it whenever you need to see what is wired, which package owns a part,
  whether a facet is declared, loaded or bound, what ran after a write, why a
  connection looks missing, or whether a quiet trace means nothing happened;
  and when changing packages/visualize. Stored rows and read/write behavior are
  graph-reads-and-writes; graph query syntax is query-grammar, not anatomy's
  plain-text search. Wiring packages is packages-and-plugins; changing effects
  or rules is effects-and-rules. Building the screen is ui-building, not just
  reading it. Automated assertions are testing; proving commands or the page
  on an isolated scratch host is end-to-end-checks. Observation is not proof.
---

# Platform anatomy and activity

The visualizer reads the host that is actually serving it. Anatomy is the
host's value-free description of its composed parts and connections. Activity
is a bounded subscription to that host graph's existing process-local trace
channel. Neither is an inspection of stored entities, a second composed
platform, or a reconstruction of work from every process sharing a store.

The reference is `packages/visualize/README.md`: read it for the DTOs, bounds,
coverage and door parameters. `packages/visualize/snapshot.ts` owns selection;
`capture.ts` owns a bounded activity capture; `http.ts`, `tools.ts` and `cli.ts`
use those contracts. Use the same snapshot or capture when comparing doors,
not a separately assembled graph whose bindings might differ.

## Choose the question before the door

- **What parts are present and connected here?** Read anatomy. Filter by group,
  plain-text search or an exact anatomy part id. A part id is not a stored
  entity id. The selection counts nodes, not edges; retained edges connect two
  included nodes. A plain HTTP snapshot preserves the full anatomy; selected
  results report total, matched, shown and a truncation flag.
- **What work ran, and what caused it?** Subscribe before the action, or take a
  capture that remains subscribed while the action occurs. Start and end events
  share a span id; parent span ids show causal relationships. An event is not
  a graph row. A duration of zero is valid, not a missing observation.
- **What data did a write store or a query return?** Use
  `graph-reads-and-writes` and `query-grammar`. The visualizer deliberately
  excludes entity contents, query text, payloads and secret values; secret
  anatomy contains names only. An operation's name, count and duration do not
  tell you its returned values.

Anatomy search is a plain-text match over part metadata, not a yaks query.
Pasting `.task.status=open` into it does not inspect tasks. Filtering a view
also does not change the composed host or prove a part is absent elsewhere.

## Read coverage before diagnosing absence

Declaration, loading and binding are independent facts. A declared lazy facet
need not have been imported; an imported tool need not be bound to this host.
Anatomy does not import lazy facets or resolve secret getters to make the
picture more complete. Use `packages-and-plugins` to change wiring,
`vocabulary` to change the words a package declares, and `effects-and-rules`
to change what follows a write.

Read the snapshot's scope and per-group observed flags. An unobserved category
is not globally absent. Empty results may be a filter, a limit, a host that
cannot observe that category, or genuinely no parts in the observed category.
Use selection counts and truncation to distinguish those cases rather than
inferring from the visible nodes alone. Activity phase events do not add a
synthetic anatomy group to the selection API.

Activity coverage is process-local and recording is subscriber-only. Without
an active subscriber, earlier idle work is not reconstructed. The page or an
activity capture observes only the exact graph channel in that serving
process; another process using the same database is outside that coverage.
An empty capture therefore is not evidence that no work happened.

Sequence numbers are meaningful within their epoch. A capture's `gap` is a
known omitted record count, including records excluded by its limit or lost
from its bounded history during capture. It cannot count work that was never
recorded. The page's gap indicator counts discontinuity episodes, not omitted
records. Read connection state and epoch changes before treating a disconnect
or reconnect as a period of platform inactivity.

## Use a door without changing the subject

The page is `/visualize` on the selected serving origin. Its anatomy, selection
and bounded live activity are a way to explore a host, not a replacement for
its stored-data inspector. Building or changing that screen also takes
`ui-building`; proving it works takes `end-to-end-checks`.

The agent doors are `visualize_anatomy` and `visualize_activity`. They use the
actual tool host, not a graph supplied as an unrelated runner argument. Read
their advertised inputs for the current bounds. The activity tool's wait is a
bounded observation window, not an instruction to run a query or write.

The terminal door reads the serving process over HTTP, rather than composing
a fresh graph to answer the question:

```sh
yak visualize anatomy --group tools --json
yak visualize activity --limit 32 --wait 250 --json
```

Use `--url` to select an HTTP(S) serving origin when native config is not the
host you intend. `--json` prints the exact returned DTO; human output is a
bounded overview. The agent tool always selects anatomy, while an unfiltered
HTTP anatomy read preserves the plain snapshot contract. Do not assume those
two requests both contain a selection object.

Authentication is the serving host's policy, not a bypass for metadata. A
missing authenticator fails closed; anonymous access is only intentional when
that policy permits it. The CLI chooses the selected origin's saved token,
keeps the explicit `YAKS_TOKEN` convention, rejects URL credentials and
non-HTTP(S) schemes, and refuses redirects. `x-via` is provenance, not a
credential. Do not loosen authentication to make a probe pass.

## Observation earns a diagnosis, not proof

Use anatomy to narrow a wiring question and trace to identify a causal path.
Then verify the claim with the owning subsystem's assertions: a visible rule
is not proof it fired correctly, and an apply span is not proof its stored
result is right. Automated door and helper contracts belong to `testing`.
Manual page, CLI and runtime checks belong to `end-to-end-checks`, on an
isolated scratch host running the branch's own code, never a live service.

When adding observation, extend the existing trace stream rather than a
parallel timing system. Keep fixed operation labels and counts value-free,
preserve inactive-channel behavior, and release observers on cancellation.
Read `packages/trace/mod.ts` and the visualizer reference before changing the
recording lifecycle or treating spans as persistent history.

When this skill is wrong or missing something, fix it in the same change.
