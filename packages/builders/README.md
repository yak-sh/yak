# @yaks/builders

A builder turns each outer binding of a graph query into one durable build. The
builder names a registered tool; the tool returns named outputs through the same
contract whether its implementation is code or a model session.

```sh
deno add jsr:@yaks/builders
```

- `builder{query,to,immediate,floor,wiring}` is the definition. `to` references
  a `tool` entity. `immediate` reconciles selected changes in their write
  transaction; `floor` is the earliest scheduled reconciliation. `content.body`
  is an optional `$var` template; `using{provider,model,effort}` chooses model
  details. `doc.body` is documentation.
- `build{builder,match,variant,for,key,inputs,definition,call,stale}` is one
  instance per outer entity-ID tuple and variant. `match` stores that tuple as
  JSON; `for` names the entity it was built for, the first the tuple holds, as a
  reference a query can follow: `.build.for=X` is X's builds, and
  `.built.build.build.for=X&.built.current=true` what was built for X now.
  Nested bracket collections change the key but keep the build. A vanished
  binding marks its build stale and retains its outputs; a returning binding
  reuses the same build. An answer that lands after its binding vanished is kept
  too, so a binding returning under the same key has it without asking again.
- `built{build,slot,key,inputs,definition,call,artifact?}` is one retained take
  of a named slot. `chosen{at,by,via}` marks the take in use, one per
  build/slot. The newest successful answer is chosen by default. `built.current`
  means chosen, the binding still exists and its inputs still match; a pending
  reroll with unchanged inputs keeps the chosen take current. Readers selecting
  `.built.current=true` need no separate take selection. Shadows remain separate
  variants, never downstream inputs.
- Builds and takes keep minted eids, free to cite and link. `build_of` holds
  `<builder>/<variant>/<match>`. A take's `output_of` holds
  `<build>/<slot>/<call>`: replay finds that call's takes, a new call adds new
  ones. `outputFor(graph, build, slot)` finds the chosen take;
  `outputFor(graph, build, slot, call)` finds that call's take by its key.

  yak builder choose <output>

Choosing spends nothing and does not affect other slots. The choice is
server-owned and every host enforces one choice per build/slot. All takes are
queryable with `.built.build=<build>&*`; add `.chosen` for the choice. A late
answer is retained but does not steal the current choice. Replaying an answer
also leaves the person's choice alone. A full answer with an omitted slot clears
that slot's choice, never its historical takes or links.

A changed key writes a fresh `call{to,source,args}` with `source` set to the
build and `args` containing the frozen binding tree, key, template, using and
wiring. `build.inputs` fingerprints the binding's entities and variable values,
including nested collections; changes the query does not read leave it alone.
`build.key` is an opaque attempt key shared with its outputs: a deliberate
reroll gets a fresh one, even with identical inputs. Definition edits never
invalidate current outputs.

`builder.definition` fingerprints the template, effective using, wiring, tool
and its revision. `build.definition` and `built.definition` keep the fingerprint
used by the attempt and output. `.build.outdated=true` finds attempts made under
a different definition; `.built.build.build.outdated=true&.built.current=true`
finds their current outputs. `build.stale` still means a vanished binding.
Legacy attempt keys and outputs stay untouched. The last call's frozen binding
is adopted as the input fingerprint without a call; existing builds are never
marked stale by a change to fingerprint computation. A legacy definition whose
historical tool revision was not recorded is unknown (null), and counts as
outdated.

Immediate builders keep `builder_dep{builder,source}` rows. A `component:name`
source names a component their query reads, including nested collections; an
`entity:eid` source names a selected input whose query values enter the key. The
effect pool records every component moved on an entity in `effect.touched`, so
one graph batch looks up only the matching dependencies. Definition edits
refresh the rows, and a compare-and-set version prevents an older reconciliation
from erasing newer dependencies.

A tool answers a bundle carrying `output{source,value}`. The source is the call
id; the value has one shape:

```json
{
  "outputs": [
    {
      "slot": "main",
      "inputs": ["source-eid"],
      "components": { "doc": { "body": "Made from the source" } },
      "artifact": "optional-artifact-eid"
    }
  ]
}
```

A tool that spent money producing its answer says so beside `outputs`, as
`"cost": 0.012` in dollars; the call stores it as
`cost{dollars, reported:
true}` (@yaks/model), whatever becomes of the build.
The model adapter keeps only the outputs of a model's answer: what its session
spent is its entries'. `build.cost` is computed, never stored: every call the
build made, each call's own `cost` and the entries of the session the model tool
opened for it, summed. `derived()` in `@yaks/builders/vocab` is its SQL.

Each output lists only the selected input entities it used. **Wiring** is the
builder definition's mapping from an output slot's reference properties to
sibling output slots. For a creature and its two sounds:

```json
{
  "builder": {
    "wiring": {
      "kind": { "sounds.cry": "cry", "sounds.step": "step" }
    }
  }
}
```

The tool supplies `kind`, `cry` and `step`, leaving `kind`'s `sounds` to the
builder. Wiring creates an omitted component and overrides tool-supplied
property values with sibling output ids before store admission. Every source
slot and sibling slot must be present in that answer; each property must be a
writable reference, and a sibling target must be a nonedge output. The call
freezes wiring so an in-flight answer keeps the definition it was asked under.
Editing wiring marks existing builds outdated without rebuilding them.

A tool may also name a nonedge sibling in a reference property as `"$<slot>"`,
which becomes that output's id; a `$` naming no sibling is refused, and text
properties keep what they say. The package validates writable components, the
artifact reference and citations before writing all outputs as one graph batch.
`cites` edges record each output's used inputs. The artifact's
`artifact{address,media_type,size}` holds byte metadata; `built.artifact` only
points to it.

A rejected answer, including a store admission refusal, writes `failed{reason}`
on its build and retains the attempt key. No output from that answer is stored;
prior chosen takes remain available. Automatic reconciliation does not spend
again on the same work. An explicit rebuild or changed inputs starts a fresh
call and clears the failure. A store refusal ends the answer effect after
recording the failure; unexpected errors also reach the host's effect reporter.
A late answer cannot fail a newer call.

An output wearing `edge{from,to}` and one relation beside it is a link:

```json
{
  "slot": "needs item-eid",
  "inputs": [],
  "components": {
    "edge": { "from": "$tome", "to": "item-eid" },
    "needs": { "count": 2 }
  }
}
```

A link is identified by its ends and relation (@yaks/edge), so it lands on that
derived id and carries an `output_of` key; its slot names it in its answer like
any output's. One of its ends must be a nonedge sibling output, which makes the
link this take's alone. An answer that omits a link leaves it as history, not
chosen. `.built.build=<build>&.references` reads every take's links; add
`.built.current=true` to read chosen links only.

`modelTool()` is an internal registered tool for model builders. It renders
`content.body` from the frozen binding (`$name` is a variable's value, or its
distinct values inside a bracket; the variable a bracket binds its members to,
`$p` in `[$p .note, doc.body=$body]`, says every member as a JSON list of the
variables it binds, so a member's values stay together), opens an ordinary
@yaks/session transcript with `using`, and adapts that transcript's reply to the
same output value. Replaying a call reuses its existing session. The reply is
the output of an ask that called no tools: prose beside a tool call is the model
at work. It is read once its ask's `attempt` completes, since a streamed reply
is written as it arrives. A session that fails for good records failure while
keeping its attempt key, so automatic reconciliation does not spend again. A
tool's refusal answered to the model and a request the runner retries do not
fail the build. `sending.tools` names the tools the session is offered
(@yaks/session), so a builder's model reads and writes the graph through exactly
the tools its builder names. `builder.to` points at `modelToolEid()` for this
adapter. The tool runner records the call and result; builders does not run a
model itself.

## Code answered in place

A **code tool** is one whose answer is a pure function of what its call asks:
the frozen binding, template, using and wiring, and nothing else it reads or
writes. `code({name, description, revision, answer})` makes one from that
function. A process that holds it in `tools` answers it **in place**: the
reconciliation that plans a build calls `answer` and writes the build, its call
and its outputs in the same batch. There is no runner claim, no `result` or
`output` record, no answer effect, and the call keeps every argument but the
binding, which is the build's own inputs. An immediate builder's outputs are
then current in the very write that changed its inputs. The tool's row is
written where it is missing or says another revision, so no runner is needed.

```ts ignore
let twice = code({
  name: 'twice',
  description: 'Double the number a source holds',
  revision: '1',
  answer: ({ binding }) => ({
    outputs: [{
      slot: 'main',
      inputs: [binding.entities[0]],
      components: { doc: { body: String(Number(binding.vars.n) * 2) } },
    }],
  }),
})
let here = { tools: [twice] }
let g = graph({ storage, vocab, plugins: [...plugins(host, here), ...] })
fx.handle(watches({ ...here, vocab }))
```

`plugins(host, here)` answers in place where an input write reconciles an
immediate builder, `watches` and `effects` where a door or a wake does, and
`build` takes the same options. An answer that throws or breaks the contract
writes the build's `failed{reason}` under its attempt key, as a refused answer
does, and `report` in the same options hears it, unless it was a refusal. A
process without the tool writes the call as ever; `code()`'s `run` is the same
answer, so a runner holding the tool makes the same outputs.

Per output, a code tool answered by a runner writes about 11 entities in three
transactions after the plan (the claim; the output, result and execution; the
take, its key and citations). Answered in place it writes six, all in the
reconciliation's one batch: the build, its key, its call, the take, its key and
a citation per input.

`builder build <builder>` reconciles now, independent of `floor`. Without a redo
flag, a current output is never touched: only new bindings or changed inputs
build. `--outdated` additionally redoes bindings made under an older (or
unknown) definition. `--rebuild` redoes every selected binding, including
unchanged ones. Both combine with `--only` and `--limit`:

    yak builder build <builder> --outdated --limit 3
    yak builder build <builder> --rebuild --only <id>

`builder_build` also accepts `space`, `app` and `as` for a hosted app. It sends
the same arguments to that account's yaks.app connector, where the selected
store resolves the builder and binding references. For example, pass
`{ "builder": "recipe-notes", "space": "cookbook", "app": "recipes", "limit": 3 }`.
The CLI mirror is
`yak builder build recipe-notes --space cookbook --app recipes --limit 3`.

An alternate model, provider, template or native input creates a shadow variant.
Unchanged inputs create no call unless a redo flag selects them.
`--input @input.json` merges the object into `sending.input` for that shadow
run, without editing the builder. A scheduled wake checks the builder again. A
configured `rest` advances `floor` after a call starts. Opening or moving a
builder to a future `floor` records a wake for that instant when `@yaks/wake` is
installed; its clock makes the builder eligible without a restart scan.

`builder build <builder> --only <id…>` builds only the bindings whose outer
entities are named (any id form, as in every write), and `--limit <n>` builds
the first n; together, the first n of those named. A partial run leaves every
other build as it is and never marks one stale. It combines with an alternate
model or template, so a new prompt is tried on a few rows as a shadow while the
main outputs stay what readers select. A name in no binding is refused.

A builder carrying the `staged{at,by,via}` mark is being tried before it builds
everything: creating it, editing it, a wake and a change to its inputs all leave
it alone, and only `builder build` builds it, usually with `--only` or
`--limit`. Removing the mark is the commit: the builder reconciles once, as when
it was created, and a sampled binding whose inputs are unchanged is not asked
again, so only the rest are. Nothing about staging enters a build's key.

A builder carrying @yaks/kernel's `archived{at,by,via}` mark is put away, and no
door builds it: `builder build` refuses, saying it is archived, and neither a
change to its inputs nor a wake reconciles it. Removing the mark restores every
door; nothing builds at that moment, so an immediate builder catches up on its
next input change or `builder build`.

## Exports

- `@yaks/builders`: vocabulary, `key`, `buildFor`, `outputFor`, `selected`,
  `reconcile`, and `code`, a code tool answered in place.
- `@yaks/builders/model`: `modelTool`, `modelToolEid`, and template `render`.
- `@yaks/builders/graph`: output choice and transactional immediate-builder
  reconciliation, `plugins(host, here)`.
- `@yaks/builders/effects`: `watches` and `effects`.
- `@yaks/builders/tools`: the on-demand `builder build` tool, and `build`, the
  same reconciliation for a host that offers it through a door of its own.
- `@yaks/builders/vocab`: the schema in `builderDoc`, and `derived`, the SQL of
  `build.cost` and `built.current`.

Compose @yaks/kernel, @yaks/tools, @yaks/edge, @yaks/key, @yaks/session,
@yaks/blob, @yaks/model and @yaks/wake vocabulary where the model adapter runs.
Storage must implement `Tx.bindings` so bracket collections and outer bindings
have one meaning. @yaks/sqlite does.

## Supplying an existing artifact

`builder supply <builder> <for> <slot> <artifact>` answers one outer binding
without calling its tool or spending money. `for` names the binding's first
entity, and must identify exactly one binding. Supply works on staged builders,
not archived ones. Build and output ids are found through their `build_of` and
`output_of` take keys. Each supply adds a take and chooses it; earlier supplied
artifacts remain linked to the same binding.

`builder_supply` takes the same arguments as named fields. Optional `args` keeps
provenance (the original prompt, model, loudness audit) beside the frozen
binding on the completed call. Other slots are left alone. Reconciliation asks
nothing until the binding's own inputs change. The package's
`supply(graph, vocab, ask, actor)` function serves hosted stores too; yaks.app
exposes it through the editor-only `builder_supply` tool.
