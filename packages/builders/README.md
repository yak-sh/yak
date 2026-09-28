# @yaks/builders

A builder runs an instruction over graph inputs selected by a query. One run can
write many named output entities, each with its own components. An output keeps
its id across rebuilds and cites the inputs used to make it.

```sh
deno add jsr:@yaks/builders
```

- `builder{query, model, format, floor, immediate}` — the `doc` body is the
  instruction. `query` uses [@yaks/query](../query)'s grammar. `floor` is the
  earliest a scheduled run may start; `immediate: true` also builds when an
  input changes. `model` overrides the host's default. `format: 'artifact'` asks
  a media model for one selected input instead of asking a text model for JSON.
- `build{builder, variant, key, session, inputs, model, prompt}` — the latest
  run started for one variant. Its stable id lets the key guard concurrent
  starts.
- `built{builder, variant, slot, key, session, model}` — one output. Its id is
  derived from the builder, variant and stable slot; its other components are
  what the builder wrote.

The key hashes the instruction, model and the id and content hash of every
matched input. Content is client-written properties, without server stamps. A
new match, removed match, or changed input changes the key; an unchanged key
opens no session. The builder and its own outputs are excluded from its input
query. Shadow outputs are excluded from all builders' input queries.

A run opens one session whose first entry asks the instruction and lists the
selected input ids. The session answers with JSON:

```json
{
  "outputs": [
    {
      "slot": "Ada",
      "inputs": ["land-id"],
      "components": {
        "doc": { "title": "Ada", "body": "Keeps the forge." },
        "villager": { "role": "smith" }
      }
    }
  ]
}
```

Each slot names the same output across runs. `inputs` names the selected
entities that _this output_ used; it may be a subset of the run's inputs. The
builder writes one graph change containing all outputs and their verified
`cites` edges. An output no longer citing an input loses that edge. Omitted
components are unchanged, and an omitted slot keeps its last output. A malformed
answer is reported and leaves the key retryable at the next check. The model can
write only client-writable properties; it cannot supply an eid or change builder
metadata.

An artifact builder selects one input. Its request is the builder's instruction
followed by that input's `doc.body`. The model's attachment becomes one stable
`built` output in slot `main`: `built.artifact` points to the stored bytes,
`built.media_type` names the type, `doc.body` keeps the exact request, and a
`cites` edge points to the input. Changing that input reruns only its builder.

Another builder can query a named output and cite it. When the output's content
changes, that citation becomes stale and the downstream builder's key changes.
With `immediate: true`, it builds then, even while its scheduled floor is in the
future. Without it, the changed key waits for a wake, schedule or on-demand
build. A new or removed query match works the same way.

`builder build <builder>` checks now regardless of the floor. An alternate
provider, model or prompt starts a shadow variant. Shadow output ids are
separate from the primary outputs and are not selected as downstream inputs. A
deleted run stays deleted. It retries a failed session under the same key when
called again; moving the builder's floor due or firing its wake does too.
Incidental graph changes do not start a retry loop.

A builder is checked when created, when its floor changes, and when a
[@yaks/wake](../wake) wake fires on it or points at it. A configured `rest`
advances the floor after each run. The `builder_open` effect also sweeps
builders at worker startup. This package opens sessions but does not launch a
process itself.

```json
{
  "use": "@yaks/builders",
  "with": {
    "desk": {
      "provider": "Y-openai",
      "model": "O-gpt-6",
      "effort": "high",
      "persona": "N-scribe",
      "actor": "N-scribe",
      "ask": "Write up what is waiting."
    },
    "rest": "1h"
  }
}
```

`desk` names the session to open. `ask` supplies an instruction when the builder
has no `doc` body. Without a desk, no effects run and the tool refuses. An
invalid `rest` reports a warning and disables the effects. Effect failures are
reported after the initiating graph write commits.

## Exports

- `@yaks/builders`: vocabulary, `content`, `key`, `run`, `output`, `due`,
  `inputs`, `plan`, `build`, `decide`, and their types.
- `@yaks/builders/vocab`: the schema in `docs`.
- `@yaks/builders/effects`: `effects(host, options)`, `watches`, and the
  handlers `opening`, `ringing`, `answering` and `changing`.
- `@yaks/builders/tools`: `runs(host, options)`, the `builder build` tool.

Compose kernel, doc, edge, session, model and wake vocabularies beside this
package, and configure a session runner to execute the sessions it opens.

## Compatibility

Deno and Node. `./vocab` is JSON with no runtime calls; the rest uses web crypto
and the graph supplied by its caller.
