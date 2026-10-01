---
name: builders-and-builds
description: >
  How a builder turns each match of a query into durable output entities
  through a model or a code tool (@yaks/builders), on the box and in yaks.app
  stores: writing one builder per job with a `$var` template, outputs, slots,
  `$slot` siblings and edge outputs, chaining through `built.current`, staging
  and shadows, cost, and reading what was built for an entity. Use it whenever
  you write or change a `builder{…}`, its `content.body` or `using`, a tool a
  builder calls, or anything that reads `build` or `built` rows; whenever you
  run `yak builder build`, try a prompt on a few rows, or ask what was built
  for something; and when a builder rebuilds everything, never builds, costs
  too much or loses its outputs, even if the request only says "have a model
  make one for each", "generate", "invent" or "fill these in". The query's
  syntax is `query-grammar`; effects in general are `effects-and-rules`; the
  store a hosted builder runs in is `yaks-app`.
---

# Builders and builds

A builder is a standing instruction: for every match of a query, ask a tool
for named outputs, and keep them as entities. The graph says what exists; the
builder says what should be made of it, and keeps that true as the graph
changes. Builders are how this system invents things at run time: a sound for
each `sfx`, a creature for each `/spawn` (D-61621), a spell for each spellbook
(D-61649). Jeff, on D-61621: "builders are super important and we should rely
on them more and more as the package stabilizes". packages/builders/README.md
is the reference; this is how to use them well.

## The shape

- `builder{query, to, immediate, floor}` with `content{body}`, the `$var`
  template, and `using{provider, model, effort, tools}`. `doc.body` documents
  the builder and is never sent. `to` is a `tool`: `modelToolEid()`
  (@yaks/builders/model) asks a model through an ordinary @yaks/session
  transcript; a registered code tool answers the same contract.
- Each outer binding of the query is one `build{builder, match, variant, for,
  key, call, stale}`, found by its `build_of` key (@yaks/key), which says the
  builder, the variant and the binding's entities. A bracket gathers members
  into the one binding:
  `$region .region; [$sfx .sfx, sfx.region=$region]` is one build per region.
- `$name` in the template is that variable's value in the binding; inside a
  bracket it renders as the README's `modelTool()` paragraph says.
- Each output is `built{build, slot, key, call, artifact, current}`, found by
  its `output_of` key, which says the build and the slot, so a rebuild rewrites
  the same entity. A slot the next answer leaves out stays as history, not
  current.
- A build's or an output's eid is minted, never derived from what made it, so
  it is an ordinary entity to cite and link. `buildFor` and `outputFor`
  (@yaks/builders) find one by its key.

## One builder per job

Write one builder that builds once per row, never one builder per row. The
vale's sound builder is `$sfx .sfx, doc.body=$description` with the template
`Generate one isolated game sound effect. … $description`
(apps/vale/data/sfx/01.json): fifty sounds, one definition, and a new `sfx` row
is built without touching the builder.

## The key decides what rebuilds

A build's key hashes the template, the effective `using`, `builder.to`, the
tool's `revision`, and the content of every entity in the binding tree
(packages/builders/key.ts). A changed key opens a new call; an unchanged key
asks nothing. So:

- **Bind only what a build depends on.** Everything bound is hashed: binding a
  catalogue (all 173 item designs, say) rebuilds every build whenever any item
  changes. Reference material goes to the model through tools offered with
  `using.tools`, not through the binding (D-61649).
- **Editing the template or `using` rebuilds every build.** That is the
  meaning of a new prompt. Try it as a shadow or on a staged builder first.
- The query's text, the variant's name, `staged` and `archived` never enter a
  key. A query edit rebuilds only the bindings whose bound values changed, and
  staging or a shadow never rebuilds a main build.

## Answers

A tool answers `{"outputs": [...], "cost": 0.01}`; each output is
`{slot, inputs, components, artifact?}`, citing only selected inputs (each
becomes a `cites` edge). Every write lands as one change, or none of it does.

- A reference property may name a sibling output of the same answer as
  `"$<slot>"`: a creature's `sounds{cry: "$cry"}` becomes the eid of the `sfx`
  in slot `cry`. Text keeps a `$` as written; a reference naming no sibling is
  refused.
- An output wearing `edge{from, to}` and one relation is a link:
  `{"slot": "needs <item>", "inputs": [], "components": {"edge": {"from":
  "$tome", "to": "<item>"}, "needs": {"count": 2}}}`. It lands on the link's
  own eid (@yaks/edge), which finds it again without a key, one end must be a
  sibling, and a later answer that leaves it out deletes it.
- A malformed answer or a model turn that failed for good clears the build's
  key, so the next reconciliation asks again. A refusal answered to the model,
  or a request the runner retries, does not.
- The model adapter reads the reply of an ask that called no tools, once that
  ask completes; prose beside a tool call is the model working.

## When it runs

Every builder reconciles when it is created, when its definition is edited
(query, `to`, `immediate`, template, `using`), when `floor` is moved, when a
wake fires on it (`wake{target}`), each time a process starts working the
effects pool (`builder_open`'s sweep, which is how a new tool revision reaches
every build after a deploy), and on `yak builder build`. The scheduled doors
(creation, a wake, the sweep) wait until `floor` has passed; nothing fires
because it passed.

- `immediate: true` also reconciles when a selected entity changes, through
  `builder_dep` rows, and when a new entity starts matching.
- `staged{at, by, via}` holds it back from every automatic door. `archived`
  puts it away from all of them, `builder build` included.

## Trying a builder before it builds everything

Write the builder with `staged: {}`, then sample:

    yak builder build <builder> --only <id> <id>   # these bindings only
    yak builder build <builder> --limit 3          # the first three
    yak builder build <builder> --only <id> --template @prompt.md
    yak builder build <builder> --limit 3 --model <model>

`--only` takes any id form, as every reference argument does, and refuses a
name in no binding. A partial run leaves every other build as it is. An
alternate `--template`, `--model` or `--provider` builds a shadow variant
(`shadow:<hash>`) whose outputs no other builder selects; compare them with
`.build&.build.variant!=main`. Tune the template between runs, then remove the
mark (`staged: null`): the builder reconciles once, and a sampled binding whose
key is unchanged is not asked again.

In an app's store (workers/yak/builders.ts) the same door is the connector's
`builder_build` tool, which takes `only`, `limit`, `template` and `model` and
reaches the store's `/build` as the caller, after checking they may write the
app: `yak admin tool builder_build space=<space> app=<app> builder=<id> …`.

## Chaining

A downstream builder selects what an upstream one made with
`.built.current=true`, so it never gathers an output its upstream dropped or is
rebuilding. Shadows are never selected. A downstream build's key hashes the
upstream outputs it binds, so an upstream rebuild flows down by itself.

## Reading what was built

- `.build.for=X` is the builds made for X, the first entity of each binding.
- `.built.build.build.for=X&.built.current=true` is what X has now: `built.build`
  reaches the build, and `build.for` is read there. Add
  `.built.build.build.variant=main` to leave shadows out.
- `.fields` brings what an output points at in the same answer. The vale's
  sound catalogue is one subscription (apps/vale/samples.ts `SOUNDS`):
  `.built.current=true&.built.artifact&.built.build.build.variant=main&.fields=built.build.build.for.sfx.name,built.artifact.artifact.address,…`.
- `build.match` is the binding as JSON, read whole; nothing filters on it.

## Cost

Each call a model builder makes opens one session, and `build.cost` sums what
its calls spent, computed and never stored. On yaks.app a builder spends the
account's one budget (M-42105) through the store's session runner
(workers/yak/builders.ts, models.ts), which is why only app editors may write
one (workers/yak/public/docs/models.md, "Build from stored rows"). Before
committing a staged builder, multiply a sample's cost by the rows it matches.

## When something is wrong

- `yak graph query '.build.builder=<builder>&*'`: each build's key, call and
  whether it is stale; `.call.source=<build>&*` its calls, and the session a
  model call opened.
- Rebuilding everything: something bound changed for every build (a shared
  entity in the binding, the template, `using`, the tool's revision).
- Never building: a future `floor`, `staged`, `archived`, a builder that is
  not `immediate` waiting for a door, or a missing tool.
- `yak effect check` shows failed and overdue builder effects.

When this skill is wrong or missing something, fix it in the same change.
