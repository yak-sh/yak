# @yaks/builders

A builder turns each outer binding of a graph query into one durable build. The
builder names a registered tool; the tool returns named outputs through the same
contract whether its implementation is code or a model session.

```sh
deno add jsr:@yaks/builders
```

- `builder{query,to,immediate,floor}` is the definition. `to` references a
  `tool` entity. `immediate` reconciles after selected graph changes; `floor` is
  the earliest scheduled reconciliation. `content.body` is an optional `$var`
  template; `using{provider,model,effort}` chooses model details. `doc.body` is
  documentation.
- `build{builder,match,variant,key,call,stale}` is one instance per outer
  entity-ID tuple and variant. `match` stores that tuple as JSON. Nested bracket
  collections change the key but preserve this identity. A vanished binding
  marks its build stale and retains its outputs; a returning binding reuses the
  same build.
- `built{build,slot,key,call,artifact?}` is one named output. Its id derives
  from its build and slot. It is current when its build is not stale and the two
  keys match, which `built.current` computes, so a downstream builder selects
  `.built.current=true` and never gathers a point its upstream dropped. An
  omitted slot remains as history, with its previous key. Shadow builds have
  separate ids and their outputs are not selected by other builders.

A changed key writes a fresh `call{to,source,args}` with `source` set to the
build and `args` containing the frozen binding tree, key, template and using.
The key hashes the template, effective using, tool revision, and the content
hash of every entity in the binding tree. The tool's registered `revision`
changes the key when its implementation changes.

Immediate builders keep `builder_dep{builder,source}` rows. A `component:name`
source names a component their query reads, including nested collections; an
`entity:eid` source names a selected input whose content enters the key. The
effect pool records every component moved on an entity in `effect.touched`, so
one graph change looks up only the matching dependencies. Definition edits
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

Each output lists only the selected input entities it used. The package
validates writable components, the artifact reference and citations before
writing all outputs as one graph change. `cites` edges record each output's used
inputs. The artifact's `artifact{address,media_type,size}` holds byte metadata;
`built.artifact` only points to it.

`modelTool()` is an internal registered tool for model builders. It renders
`content.body` from the frozen binding (`$name` is a variable's value, or its
distinct values inside a bracket; the variable a bracket binds its members to,
`$p` in `[$p .note, doc.body=$body]`, says every member as a JSON list of the
variables it binds, so a member's values stay together), opens an ordinary
@yaks/session transcript with `using`, and adapts that transcript's reply to the
same output value. The reply is the output of an ask that called no tools: prose
beside a tool call is the model at work. A session that fails for good leaves
its build's key clear, to be asked again on the next reconciliation; a tool's
refusal answered to the model, and a request the runner retries, do not.
`using.tools` names the tools the session is offered (@yaks/session), so a
builder's model reads and writes the graph through exactly the tools its builder
names. `builder.to` points at `modelToolEid()` for this adapter. The tool runner
records the call and result; builders does not execute models or code itself.

`builder build <builder>` reconciles now, independent of `floor`. An alternate
model, provider or template creates a shadow variant. A repeated key creates no
call. A scheduled wake checks the builder again. A configured `rest` advances
`floor` after a call starts.

## Exports

- `@yaks/builders`: vocabulary, `key`, `run`, `output`, `selected`, and
  `reconcile`.
- `@yaks/builders/model`: `modelTool`, `modelToolEid`, and template `render`.
- `@yaks/builders/effects`: `watches` and `effects`.
- `@yaks/builders/tools`: the on-demand `builder build` tool.
- `@yaks/builders/vocab`: the schema in `builderDoc`, and `derived`, the SQL of
  `build.cost` and `built.current`.

Compose @yaks/kernel, @yaks/tools, @yaks/edge, @yaks/session, @yaks/blob,
@yaks/model and @yaks/wake vocabulary where the model adapter runs. Storage must
implement `Tx.bindings` so bracket collections and outer bindings have one
meaning. @yaks/sqlite does.
