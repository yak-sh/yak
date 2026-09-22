# @yaks/dreaming

Store scheduled agent work and create a session when it becomes due. A `dream`
is an entity describing recurring or deferred work; its `doc.body` contains the
instructions. This package also declares counters and relationships that record
memory retrieval. It writes to the graph supplied by the caller, not to a
separate database.

```sh
deno add jsr:@yaks/dreaming
```

- `dream{scope, floor}` — a scheduled work item associated with a project.
  `floor` is a timestamp: the earliest it may run again.
- `recall{count, first_at, last_at}` — how many times an entity has been
  recalled, and when it last was. This is the data dreaming works over.
- `recalled` — an edge relation: this entry recalled that entity, at this time.
- `meta` — marks text in a transcript as a note: it is never delivered to anyone
  live, and is read later by a dream.

The memories themselves belong to [@yaks/memory](../memory). This package covers
what happens to them between conversations.

## The session a dream opens

When a dream comes due, this package opens one agent session on it and asks it
the dream's own body text. In the code and in the configuration that session is
called a **desk** (`desk.ts`, the exported `desk()` function, the `desk` config
key).

The `floor` column stores the earliest start time. Create a dream with body text
and a floor timestamp to request future work. Two checks prevent repeated
starts:

- while the session is open it holds the dream's `claim`
  ([@yaks/session](../session)'s lock), so a second trigger finds the claim and
  does nothing;
- opening one moves `floor` forward when a `rest` interval is configured.
  Without `rest`, only the claim prevents another start. This package does not
  release a dead session's claim; session cleanup must do that.

A dream is checked when it is created, when its `floor` is changed to a time
that has already passed, and when a [@yaks/wake](../wake) `wake` on it — or one
aimed at it through `wake.target` — fires. Nothing polls.

```json
{
  "use": "@yaks/dreaming",
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

The configuration selects the provider, model, effort, persona and actor used by
the new session. Replace the example identifiers with entities in your graph;
these values are not built-in accounts or models. `ask` supplies fallback text
when the dream has no body. With neither body nor `ask`, no session opens.

A configuration without `desk` registers no effects, allowing a graph to store
dreams without running them. `rest` is a @yaks/wake recurrence (`1h`, `@daily`,
`0 9 * * 1-5`). An invalid recurrence produces a warning during plugin
composition and disables these effects instead of preventing startup.

No process is launched here. What this package writes is a session row and its
first entry — [@yaks/session](../session)'s components, plus the `references`
edge to the persona — and a separately configured session runner executes it.
The following is a schematic list of bundles (one entity's components as a JSON
object), not executable input:

```
{ entity: { eid: s }, session: { actor: 'N-scribe' } }
{ entity: { eid: e }, entry: { session: s, seq: 1 },
  content: { body: "Write up what is waiting." },
  using: { provider: 'Y-openai', model: 'O-gpt-6', effort: 'high' } }
{ entity: { eid: relationId }, references: {} , edge: { from: s, to: 'N-scribe' } }
{ entity: { eid: dreamId }, claim: { session: s },
  dream: { floor: '…+1h' }, recall: { count: 2, … } }
```

The dream's `recall` records how many sessions were opened and the first and
latest opening times, not whether the requested work succeeded. These counters
are server-stamped, so the effects writer must apply them as trusted writes.

The handler is idempotent — a dream that is resting, or already claimed, opens
nothing — so the registration declares `sweep: { pending: '.dream' }` and the
server may replay it over every dream at boot. A failure in an effect is
reported by @yaks/effects after the original transaction has committed; it
cannot roll that transaction back. This package does not check whether a model
is served locally: execution failures belong to the session runner.

## Exports

- `@yaks/dreaming`: `dreamingDoc`, component-name constants, `due`
  (earliest-start check), `desk` (construct session and claim bundles),
  `opening` and `ringing` (effect handlers), `watches` (their registrations),
  and `Desk`/`Open` types.
- `@yaks/dreaming/vocab`: the schema in `docs`.
- `@yaks/dreaming/effects`: the `effects(host, options)` factory. Here `host`
  means the process that opened the graph; the factory currently uses only
  options. Load the session, doc, kernel and wake schemas and the corresponding
  execution services when configuring a runnable graph.

## Compatibility

Deno and Node. `./vocab` is a JSON document with no runtime calls; `./effects`
uses only `crypto.randomUUID` and the graph it was passed.
