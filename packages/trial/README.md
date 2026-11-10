# @yaks/trial

Scores a way of assembling an agent's context on the corrections it missed. A
case is an entity wearing @yaks/memory's `miss{entry, needed, across, told}`
beside `feedback{by}`: the entry that erred, and the entity that held the fact
it lacked. A variant is a persona. A trial scores one variant on one case and
writes `trial{case, variant, asked, unasked, tokens}`, its eid derived from the
two, so a rerun replaces the score.

- `unasked`: the needed entity was among what the variant put in front of the
  agent before its entry.
- `asked`: a search with the first twelve words of the message the agent was
  answering (the latest entry someone wrote to it: a person's input or its
  brief) returns it among the first five rows that predate the entry.
- `tokens`: the size of what was put in front, at four characters a token.

## What was in front

`@yaks/trial/moment` rebuilds it from the graph at the entry's `created.at`:

1. The persona, worn (@yaks/persona `wear`) over the graph as it stood then: its
   text and every document it contains in full. A document it only names by id
   is a pointer, not the fact.
2. From the entry's session since the latest compaction before it
   (`checkpoint`): the compaction summary, each `notice`, each entity a knock
   delivered through the session (`notified{via}`), and each `hit` row a write's
   result returned (a hit naming the entity it was `near`).

The agent's own searches and reads are left out: they were asked for. So is a
person's pointer to the graph.

`asOf(storage, vocab, at)` is the graph at a moment: rows created before it,
marks (components with an `at`) stamped before it, and each status read again
from the marks left. The store keeps no versions, so a body edited since reads
as it reads now, and a claim or edge removed since is gone.

## Running it

```sh
yak trial            # every case, under the persona its session wore
yak trial <persona>  # every case, under another persona
```

It prints the tally: cases, how many the graph held, how many were in front
unasked, how many a search found, and the mean tokens.

```ts
import { trial } from '@yaks/trial'

let row = trial({ eid: 'case', needed: 'm' }, 'persona', [
  { door: 'persona', eids: ['persona', 'm'], text: 'be good' },
], [])
console.log(row.trial) // unasked: true, asked: false, tokens: 2
```
