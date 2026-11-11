# @yaks/trial

Trials as rows, of two kinds. A **context trial** scores a way of assembling an
agent's context on the corrections it missed; a **skill trial** develops a skill
by rounds of attempts that a person and judges compare. Both name a case and a
variant, and they share no component: a context trial's score is computed from
the graph alone, one row per case and variant, while a skill trial's attempts
are written by models and judged afterwards, many to a case and variant.

## Context trials

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

### What was in front

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

### Running it

```sh
yak trial score            # every case, under the persona its session wore
yak trial score <persona>  # every case, under another persona
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

## Skill trials

A skill is developed by rounds. Writers are each handed one candidate text of
the skill and one case, a person taps through pairs of what they returned,
judges score the rest, and the tally of both plans the next round. Whoever runs
the writers writes a round file; everything after that is rows.

| on an entity                                                                | what it is                                                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `round{skill, parts}` + `doc{title}`                                        | one round: the skill it develops and the parts every attempt returns                                              |
| `variant{body, theory, source, licence, from}` + `doc{title}`               | a candidate text of the skill, installed nowhere                                                                  |
| `case{body, base}` + `doc{title}`                                           | what a writer is handed; cases with one `base` are about one thing                                                |
| `riddle{name, aliases, forbidden, forbidden_exact, group}`                  | on a case: a judge guesses what the attempt describes                                                             |
| `found{name, source}`                                                       | on a case: something its maker published, kept to learn a judge's taste                                           |
| `writing{round, case, variant, persona, run, model, at, ms, reply, output}` | what one writer returned, beside @yaks/model's `usage{input_tokens, output_tokens}` and `cost{dollars, reported}` |
| `pair{round, a, b, ord}`                                                    | two attempts planned for comparison                                                                               |
| `preference{first, second, chose, why}`                                     | one comparison by its `created.by`; no `chose` is neither                                                         |
| `grabbed{attempt}`                                                          | its `created.by` found the attempt appealing on its own                                                           |
| `guess{attempt, form, model, guesses, among, rank, cap, leaked}`            | one judge's guesses at a riddle attempt                                                                           |

Variants, cases, attempts and what judges them are kept out of embedding, and
their text is in their own components, not `doc{body}`, so no agent meets a
candidate skill or a pitch unasked in a search.

A person's own attempt has no `variant`, `persona` or `model`: its writer is its
`created.by`. A judge that is an agent writes the same `preference` rows a
person does, and is told apart by `created.by`.

```sh
yak trial load rounds/r1/round.json  # rows; loading again replaces them
yak trial tally copy-r1              # what the round's rows say, as text
yak trial drop copy-r1               # the round and what only it used
```

A round file is JSON: `key`, `title`, `skill`, `output` (the parts), `persona`
(the id of the persona a `persona: true` writer carried), then `variants`,
`cases`, `attempts`, `pairs` and `guesses`, each naming the others by `key`
(`RoundFile` in ./skill.ts). The round is found again as `round:<key>`, a
variant as `variant:<skill>:<key>` and a case as `case:<skill>:<key>`
(@yaks/alias), so a later round's file reuses a variant or case by naming its
key, and one that restates it replaces its text. Give a changed variant a new
key and say what it came `from`. Attempts, pairs and guesses are on eids derived
from the round's key and their own.

### The page

`yak serve` answers `/trial/<round>` with the page a person taps through the
round's pairs on, made for a phone. Several rounds are named with commas and
shown one after another: `/trial/taste1,copy-r1`. It shows one pair at a time,
shuffled, with nothing that says which variant, persona or model wrote a pitch,
and no title where the case is a `riddle` or `found`. The first two parts of
each pitch show and the rest fold behind "Read the rest".

- A tap on a pitch, or on Neither, writes
  `preference{first, second, chose,
  why}` and moves on. The why is optional,
  and typed before the tap.
- "Grabs me" on a pitch writes `grabbed{attempt}`; a second tap deletes it.
- "Add a pitch of my own" writes a `writing{round, case, output}` with no
  variant, and the deck sets it against three of the round's attempts about the
  same thing.

Each is written the moment it is tapped, through `/web/apply`, so its
`created.by` is the graph's configured person. A write that fails is kept in the
browser and sent again. Opened again, the page starts at the first pair without
a preference. The same address asked with `accept: application/json` answers the
decks (`deck` in ./skill.ts).

The tally counts, for each variant, persona arm and case: attempts, comparisons
shown, preferred, neither, grabbed, the mean guesses until right (a miss counts
as its cap plus one) and how often a pick among the group was right. It then
says whether the variants preferred are the ones guessed soonest (Spearman's rho
over the variants that have both), lists each attempt that grabbed, and each
why.
