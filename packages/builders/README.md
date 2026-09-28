# @yaks/builders

A builder is an instruction plus a query selecting its inputs. It opens an agent
session and keeps that session's answer in one output whose id stays put across
rebuilds. The output cites the input entities used for its latest build.

```sh
deno add jsr:@yaks/builders
```

- `builder{query, floor}` — the `doc` body is the instruction. `query` uses
  [@yaks/query](../query)'s grammar to select input entities. `floor` is the
  earliest a scheduled build may run.
- `built{builder, slot, key, model, session}` — the output. Its identity is
  derived from the builder and slot, normally `main`; its `doc` body is the
  latest answer. The key, model and session are build bookkeeping, not content
  that makes a downstream citation stale.

The key hashes the instruction, model and the id and content hash of every
matched input. Content includes client-written properties and excludes server
stamps. A new match, removed match, or changed input changes the key. An
unchanged key opens no session; a changed key updates the same output in place.
The builder and its own outputs are excluded from its input query, so its floor
and answer cannot feed back into itself. Shadow outputs are also excluded from
other builders' queries.

A build opens one session and its first entry. The entry asks the instruction
and lists input ids, which the session can inspect. The build updates the
output's key and session and verifies a `cites` edge from the output to each
selected input; citations to inputs no longer selected are removed. The output's
key has a `$was` precondition, so two concurrent triggers cannot both open a
session on the same version. A session's answers replace the output's `doc` body
while that session is still its current builder.

Another builder can query an output and cite it. When the upstream answer
changes, that citation becomes stale and the downstream builder's key changes on
its next check. Building immediately on input change is separate from this
package's scheduled and on-demand doors.

`builder build <builder>` checks now regardless of the floor. Passing an
alternate provider, model or prompt makes a sibling shadow output for
comparison, identified by those alternate settings. The primary output keeps its
identity. A deleted output stays deleted.

A builder is checked when created, when its floor changes, and when a
[@yaks/wake](../wake) wake fires on it or points at it. A configured `rest`
advances the floor after each build; an unchanged key still opens nothing. The
`builder_open` effect sweeps builders at worker startup. No polling or process
launch happens in this package.

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
invalid `rest` reports a warning and disables the effects instead of preventing
startup. Effect failures are reported after the initiating graph write commits.

## Exports

- `@yaks/builders`: `builderDoc`, component-name constants, `content`, `key`,
  `output`, `due`, `inputs`, `plan`, `build`, `decide`, and their types.
- `@yaks/builders/vocab`: the schema in `docs`.
- `@yaks/builders/effects`: `effects(host, options)`, `watches`, and the
  handlers `opening`, `ringing` and `answering`.
- `@yaks/builders/tools`: `runs(host, options)`, the `builder build` tool.

Compose kernel, doc, edge, session, model and wake vocabularies beside this
package, and configure a session runner to execute the sessions it opens.

## Compatibility

Deno and Node. `./vocab` is JSON with no runtime calls; the rest uses web crypto
and the graph supplied by its caller.
