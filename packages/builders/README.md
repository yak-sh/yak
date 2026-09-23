# @yaks/builders

A builder is an instruction plus its inputs, and it builds one output. This
package declares the builder and its output, works out whether a build is
needed, and opens the agent session that does it. It writes to the graph
supplied by the caller, not to a separate database.

```sh
deno add jsr:@yaks/builders
```

- `builder{floor}` — something that builds. Its `doc` body is the instruction,
  and the entities its @yaks/kernel `reads` links point at are its inputs.
  `floor` is a timestamp: the earliest a schedule may build it again.
- `built{builder, key, model, session}` — an output: what one builder built
  under one key, with the model and the session that built it. Its `doc` body is
  what that session answered.

## The key

Every build is keyed by a SHA-256 of the instruction, the model and each input's
content hash. An input's content is every property a client may write on every
component it wears; server-owned stamps (`created`, `updated`, counters) are
left out, since they move without anything being said differently.

The output's id is derived from the builder and the key (`identity` in the
vocabulary), so the key names its output before anything runs:

- **Reuse.** When the output under the current key exists, it still answers and
  nothing runs.
- **Rebuild.** A changed instruction, model or input is a new key, which names
  an output that does not exist yet. It is built from scratch, by a fresh
  session that is never shown the old output. The old output stays as it was.
- **Never its own output.** A builder's own outputs are left out of its inputs,
  even when it links to one.
- **Models side by side.** The model is part of the key, so the same builder
  built by two models gives two sibling outputs, which is how models are
  compared.

A deleted output is never written again, because a deleted id cannot be. Only a
new key builds that builder again.

## A build

A build writes one session and its first entry — @yaks/session's components —
and the output it will answer into, minted empty. No process is launched here; a
separately configured session runner executes the session. The first entry asks
the instruction and lists the inputs by id, which the session reads for itself.
When the session answers, the answer is written into the output's `doc` body;
each answer replaces the last, so a settled session leaves its final answer
there.

The output is minted in the same batch as the session, which keeps a builder to
one session per key: a second trigger finds the output and does nothing. The
write carries a `$was` precondition on the output's key, so two triggers racing
to mint it cannot both commit.

## When it builds

- **On a schedule.** A builder is checked when it is created, when its `floor`
  is changed, and when a [@yaks/wake](../wake) `wake` on it — or one aimed at it
  through `wake.target` — fires. It builds when its floor has passed and its key
  has no output. With a `rest` configured, each build moves the floor forward by
  that much. Nothing polls. The check is idempotent, so the registration
  declares `sweep: { pending: '.builder' }` and a server may replay it over
  every builder at boot.
- **On demand.** `builder build <builder>` builds now, whatever the floor says.
  `--model` and `--provider` build with a model other than the configured one,
  giving a sibling output. An unchanged key answers with the output that is
  already current.

Changing an input does not trigger a build on its own; the next scheduled or
on-demand build sees the new key.

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

`desk` names the session a build opens: its provider, model, effort, persona and
actor. Replace the example identifiers with entities in your graph. `ask` is the
instruction for a builder with no body; with neither, nothing builds. A
configuration without `desk` registers no effects and the tool refuses, so a
graph can store builders without running them. `rest` is a @yaks/wake recurrence
(`1h`, `@daily`, `0 9 * * 1-5`); one that cannot be read produces a warning
during plugin composition and disables the effects instead of preventing
startup.

A failure in an effect is reported by @yaks/effects after the original
transaction has committed; it cannot roll that transaction back.

## Exports

- `@yaks/builders`: `builderDoc`, component-name constants, `content` and `key`
  (the hashes), `output` (an output's id), `due`, `inputs`, `plan`, `build` (the
  bundles of one build), `decide` (what building one now comes to), and the
  `Desk`, `Options`, `Open`, `Plan`, `Verdict` and `Input` types.
- `@yaks/builders/vocab`: the schema in `docs`.
- `@yaks/builders/effects`: `effects(host, options)`, `watches`, and the
  handlers `opening`, `ringing` and `answering`.
- `@yaks/builders/tools`: `runs(host, options)`, the `builder build` tool.

`host` is the process that opened the graph; these facets use its `vocab`. Load
the kernel, doc, edge, session, model and wake schemas beside this one, and the
services that run sessions, for a graph that builds.

## Compatibility

Deno and Node. `./vocab` is a JSON document with no runtime calls; the rest uses
only `crypto.randomUUID` and the graph it was passed.
