# @yaks/dreaming

Background work an agent does when nobody is asking it anything: standing
intentions that come due on a schedule, and the record of how often a memory has
been recalled.

```sh
deno add jsr:@yaks/dreaming
```

- `dream{scope, floor}` — a standing intention, filed under a project. `floor`
  is a timestamp: the earliest it may run again.
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

The `floor` column is the whole queue: anything that wants writing later files a
dream with its body text and sets `floor` to when it should next run. Two guards
keep a due dream to one session at a time:

- while the session is open it holds the dream's `claim`
  ([@yaks/session](../session)'s lock), so a second trigger finds the claim and
  does nothing;
- opening one also moves `floor` forward by the `rest` interval the
  configuration sets, so a session that died without releasing its claim still
  cannot reopen before then.

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

WHAT gets opened is never decided in this package. A provider, a model, an
effort, a persona — none of those are facts about the graph, so the
configuration names them and this package decides when. A configuration with no
`desk` registers no effects at all, which is what a graph that only stores
dreams wants. `rest` is a @yaks/wake recurrence (`1h`, `@daily`, `0 9 * * 1-5`),
parsed when the plugin is composed: one this machine cannot parse is reported at
boot and the plugin then registers nothing, rather than opening a session on
every trigger.

No process is launched here. What this package writes is a session row and its
first entry — [@yaks/session](../session)'s components, plus the `references`
edge to the persona — and whatever runs sessions on this machine runs it:

```
{ entity: { eid: s }, session: { actor: 'N-scribe' } }
{ entity: { eid: e }, entry: { session: s, seq: 1 },
  content: { body: "Write up what is waiting." },
  using: { provider: 'Y-openai', model: 'O-gpt-6', effort: 'high' } }
{ entity: { eid: s }, references: {} , edge: { from: s, to: 'N-scribe' } }
{ entity: { eid: dream }, claim: { session: s },
  dream: { floor: '…+1h' }, recall: { count: 2, … } }
```

The dream's own record of having run is `recall`: how many times it has come
due, and when it last did.

The handler is idempotent — a dream that is resting, or already claimed, opens
nothing — so the registration declares `sweep: { pending: '.dream' }` and the
server may replay it over every dream at boot. A `desk` the configuration gets
wrong (a model this machine does not serve) becomes a failed effect: it is
reported, and it does not fail the transaction.

## Compatibility

Deno and Node. `./vocab` is a JSON document with no runtime calls; `./effects`
uses only `crypto.randomUUID` and the graph it was passed.
