# @yaks/dreaming

What an agent returns to when nothing is asking.

- `dream{scope, floor}` — a standing intention, filed under a project, with a
  floor under it: do not come back before this.
- `recall{count, first_at, last_at}` — how often something has surfaced, and
  when it last did. The consolidation dreaming works from.
- `recalled` — the relation an edge wears: this surfaced that, then.
- `meta` — a quiet memo: said in the transcript, never delivered live, harvested
  by the dream.

The memories themselves are [@yaks/memory](../memory)'s. This is what happens to
them between conversations.

## The desk

A dream that has come back opens a **desk**: one transcript, asked in the
dream's own words. The floor is the whole queue — whatever wants writing files a
dream and sets the floor to the quiet it wants — and two guards keep the desk to
one:

- while a desk is up it holds the dream's `claim` (@yaks/session's lock), so a
  second stir finds the lock and leaves;
- opening one moves the floor past the `rest` the host configured, so a desk
  that died without releasing cannot reopen before then either.

A dream is stirred when it is filed, when its floor is moved back into the
present, and when a [@yaks/wake](../wake) `wake` on it — or aimed at it through
`wake.target` — fires. Nothing polls.

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

WHAT opens is never decided here. A provider, a model, an effort, a voice — none
of that is a fact about the graph, so the config names it and this package says
when. A host that names no `desk` gets no watch at all, which is what a graph
that only KEEPS dreams wants. `rest` is a @yaks/wake recurrence (`1h`, `@daily`,
`0 9 * * 1-5`), read at compose time: one this box cannot read is a refusal at
boot rather than a desk per stir.

Nothing is launched. What a desk writes is a session and its first entry —
@yaks/session's words, plus the `references` edge to the voice it wears — and
whoever runs sessions on this host runs it:

```
{ entity: { eid: s }, session: { actor: 'N-scribe' } }
{ entity: { eid: e }, entry: { session: s, seq: 1 },
  content: { body: "Write up what is waiting." },
  using: { provider: 'Y-openai', model: 'O-gpt-6', effort: 'high' } }
{ entity: { eid: s }, references: {} , edge: { from: s, to: 'N-scribe' } }
{ entity: { eid: dream }, claim: { session: s },
  dream: { floor: '…+1h' }, recall: { count: 2, … } }
```

The dream's own record of coming back is `recall`: how many times it has
surfaced and when it last did.

The handler is idempotent — a resting or claimed dream opens nothing — so the
registration declares `sweep: { pending: '.dream' }` and a host may replay it
over every dream at boot. A desk the config names wrong (a model this box does
not serve) is a failed effect: telemetry, never a broken batch.

## Compatibility

Deno and Node. `./vocab` is a JSON document with no runtime calls; `./effects`
reaches only `crypto.randomUUID` and the graph it was handed.
