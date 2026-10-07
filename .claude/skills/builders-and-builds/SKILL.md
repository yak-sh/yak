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

You want a model, or a piece of code, to make something for each of many
things: a sound for each `sfx`, a creature for each `/spawn` (D-61621), a spell
for each spellbook (D-61649). Here that's a builder: a standing instruction
that, for every match of a query, asks a tool for named outputs and keeps them
as entities. The graph says what exists; the builder says what should be made
of it, and keeps that true as the graph changes. It's how this system invents
things at run time. The owner, verbatim, on D-61621: "builders are super
important and we should rely on them more and more as the package stabilizes".

It works like `make`, with one twist. Inputs are hashed, and a target is
rebuilt when what it was made from changes. But editing the recipe redoes
nothing already made: what exists is kept, and people may already be using it.
Redoing work under a new recipe is something you ask for.

packages/builders/README.md is the reference. This is the feel of using it
well: think in standing instructions, look at three before you build fifty,
and keep each output as the thing its consumers already hold.

## The shape

- `builder{query, to, immediate, floor, wiring}` with `content{body}`, the
  `$var` template, and `using{provider, model, effort, tools}`. `doc.body`
  documents the builder and is never sent. `to` is a `tool`: `modelToolEid()`
  (@yaks/builders/model) asks a model through an ordinary @yaks/session
  transcript, and a registered code tool answers the same contract.
- Each outer binding of the query is one `build{builder, match, variant, for,
  key, call, stale}`, found by its `build_of` key (@yaks/key), which says the
  builder, the variant and the binding's entities. A bracket gathers members
  into the one binding (brackets and `$vars` are `query-grammar`'s):
  `$region .region; [$sfx .sfx, sfx.region=$region]` is one build per region.
- `$name` in the template is that variable's value in the binding; inside a
  bracket it renders as the README's `modelTool()` paragraph says.
- Each answer replaces `built{build, slot, key, inputs, definition, call,
  artifact, current}` outputs, keyed by build and slot. A nonedge slot keeps its
  eid, so consumers' references stay valid. Full answers delete omitted outputs
  and links; supply replaces only its named slot. Calls keep the frozen answer
  as provenance, without keeping additional live outputs beside the replacement.
- `built.current` means chosen while the binding still exists. A pending
  replacement keeps the output playing; late answers and replays leave it alone.
  Legacy chosen rows are adopted at their next answer without changing their
  ids or asking a model just to change a key.
- A build's or an output's eid is minted, never derived from what made it, so
  it's an ordinary entity to cite and link. `buildFor` and `outputFor`
  (@yaks/builders) find one by its key.

## One builder for the job

A builder is the recipe, not the dish: one definition that builds once per
row. The vale's sound builder is `$sfx .sfx, doc.body=$description` with the
template `Generate one isolated game sound effect. … $description`
(apps/vale/data/sfx/01.json): fifty sounds, one definition, and a new `sfx`
row is built without anyone touching the builder. A builder per row, or a
script that loops a model over rows, gives up everything below.

## What rebuilds, and why

`build.inputs` hashes the binding's entities and variable values, including
nested collections. A changed value the query reads starts another attempt;
an unrelated change to a bound entity asks nothing. A fingerprint change adopts
the last call's frozen binding without making existing builds stale or spending.
`build.key` is an opaque attempt key shared with its outputs, and an explicit
reroll gets a fresh one. The definition has its own fingerprint:
`builder.definition`, kept on each attempt as `build.definition` and on each
output as `built.definition` (packages/builders/key.ts).

That split is the whole economy of a builder, and it pulls two ways:

- Variables are the build's input contract. Bind the properties the build uses.
  A shared catalogue's values bound into every binding make one edit there
  rebuild them all; hand reference material over through `using.tools` when it
  should be read separately.
- Editing the template, `using`, wiring, the tool or its revision never
  rebuilds current outputs, so tuning a prompt never silently spends on every
  row or swaps out what people already have. New bindings and changed inputs
  use the current definition.
- `.build.outdated=true` finds attempts under another definition. It's not
  `build.stale`, which means the binding vanished. Legacy definitions whose
  tool revision wasn't recorded count as outdated.
- The query text, variant name, staged and archived never enter input keys.

`yak builder build <builder>` leaves current outputs untouched. `--outdated`
redoes selected bindings under another definition; `--rebuild` redoes every
selected binding, even unchanged ones. Both combine with `--only` and
`--limit`. A new definition earns its way in as a shadow before it redoes
existing work.

## Answers

A tool answers `{"outputs": [...], "cost": 0.01}`; each output is
`{slot, inputs, components, artifact?}`, citing only the inputs it used (each
becomes a `cites` edge). The components an output wears are ordinary words,
designed in `vocabulary` like any other. Every write lands as one batch, or none of it does.

- A reference that's fixed by the design, not invented, belongs in
  `builder.wiring` rather than the prompt: the model shouldn't have to guess
  it. `{"kind": {"sounds.cry": "cry", "sounds.step": "step"}}` fills the kind's
  references to its sound outputs, overriding model values and creating an
  omitted component. The call freezes wiring; a missing source or sibling slot
  fails the build. The README's "Wiring" paragraph gives its contract.
- A tool's reference property may also name a nonedge sibling as `"$<slot>"`.
  Text keeps a `$` as written; a reference naming no sibling is refused.
- An output wearing `edge{from, to}` and one relation is a link:
  `{"slot": "needs <item>", "inputs": [], "components": {"edge": {"from":
  "$tome", "to": "<item>"}, "needs": {"count": 2}}}`. It lands on the link's
  own eid (@yaks/edge) and carries an `output_of` key for its slot. One end is
  a nonedge sibling, and a changed or omitted link is deleted on replacement.
- A rejected answer, including store admission, or a model turn that failed
  for good writes `failed{reason}` on the build and keeps its key, so automatic
  reconciliation does not spend twice. Changed inputs or an explicit rebuild
  starts a fresh call and clears the failure. A
  refusal answered to the model, or a request the runner retries, doesn't.
- The model adapter reads the reply of an ask that called no tools, once that
  ask completes; prose beside a tool call is the model working.
- `yak builder supply <builder> <for> <slot> <artifact>` answers one binding's
  slot with an artifact you already have, spending nothing (README,
  "Supplying an existing artifact"). It works on a staged builder.

## When it runs

Its automatic doors are effects (`builder_open`, `builder_edit`,
`builder_ring`), owed, retried and swept as `effects-and-rules` describes.
Every builder reconciles when it's created, when its definition is edited
(query, `to`, `immediate`, template, `using`, wiring), when `floor` is moved,
when a wake fires on it (`wake{target}`), each time a process starts working
the effects pool (`builder_open`'s sweep, which finds new and changed bindings
without redoing current outputs), and on `yak builder build`. The scheduled
doors (creation, a wake, the sweep) wait until `floor` has passed; nothing
fires just because it passed.

- `immediate: true` also reconciles when a selected entity changes, through
  `builder_dep` rows, and when a new entity starts matching.
- `staged{at, by, via}` holds it back from every automatic door. `archived`
  puts it away from all of them, `builder build` included.

## Trying it on a few

Every model call spends money, from the account's one budget on yaks.app, so a
builder starts small and gets looked at. Write it with `staged: {}`, then sample:

    yak builder build <builder> --only <id> <id>   # these bindings only
    yak builder build <builder> --limit 3          # the first three
    yak builder build <builder> --only <id> --template @prompt.md
    yak builder build <builder> --limit 3 --model <model>
    yak builder build <builder> --only <id> --input @input.json

`--only` (or the ids after the builder) takes any id form, as every reference
argument does, and refuses a name in no binding. A partial run leaves every
other build as it is. An alternate `--template`, `--model`, `--provider` or
`--input` builds a shadow variant (`shadow:<hash>`) whose outputs no other
builder selects; compare them with `.build&.build.variant!=main`. Tune the
template between runs, then remove the mark (`staged: null`): the builder
reconciles once, and a sampled binding whose inputs are unchanged isn't asked
again.

In an app's store (workers/yak/builders.ts; the store itself is `yaks-app`)
the same door is the connector's `builder_build` tool. It takes what the CLI does (`only`, `limit`, `rebuild`,
`outdated`, `template`, `provider`, `model`, `input`) and reaches the store's
`/build` as the caller, after checking they may edit the app; `builder_choose`
and `builder_supply` sit beside it. From the box:
`yak admin builder_build --space <space> --app <app> --builder <id> …`.

## Chaining

A downstream builder selects what an upstream one made with
`.built.current=true`, so it gathers the existing output while a replacement is
pending. Shadows are never selected. Bind the upstream properties the
downstream build uses, such as `built.artifact=$artifact` or
`doc.body=$description`: output ids stay stable, and the bound values make a
changed upstream output flow down by itself.

## Reading what was built

- `.build.for=X` is the builds made for X, the first entity of each binding.
- `.built.build.build.for=X&.built.current=true` is what X has now:
  `built.build` reaches the build, and `build.for` is read there. Add
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
one (workers/yak/public/docs/models.md, "Build from stored rows"). A sample's
cost times the rows the query matches is what letting it loose will cost.

## When something is wrong

- `yak graph query '.build.builder=<builder>&*'`: each build's key, call and
  whether it's stale; `.call.source=<build>&*` its calls, and the session a
  model call opened.
- Rebuilding everything: something bound changed for every build, a shared
  entity in the binding. A definition edit alone never does it; only changed bound
  values or an explicit redo.
- Never building: a future `floor`, `staged`, `archived`, a builder that isn't
  `immediate` waiting for a door, or a missing tool.
- `yak effect check` shows failed and overdue builder effects.

When this skill is wrong or missing something, fix it in the same change.
