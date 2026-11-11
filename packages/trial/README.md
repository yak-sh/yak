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

### Doors a variant adds

A variant can add to what arrives at a door beyond its persona's parts. Each
case then wears its own session's persona, the doors named add to it
(`@yaks/trial/arrive`), and the rows are written under the persona `--under`
names, whose text says what the doors add and which no session wears:

| door      | what arrives                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beside`  | beside each of the person's inputs, the prompt hook's recall (@yaks/memory/earlier), its memories and decisions kept to `--floor`                                                                        |
| `related` | beside each write's hit rows, the few nearest resources of any kind to what it made (`hit.related`, @yaks/embedding/neighbours)                                                                          |
| `said`    | beside each thing the session wrote, what its write is answered with from memory (@yaks/memory/graph): the person's nearest earlier words at least `--floor` similar, and the nearest answered decisions |
| `open`    | at the session's start and after each compaction, the tasks and decisions open with the person, and the decisions they answered the day before                                                           |

```sh
yak trial score --under <persona> --arrive beside --floor 0.6
```

The recall is given all the time it needs; the live hook gives it 700 ms.

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

| on an entity                                                                         | what it is                                                                                                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `round{skill, parts}` + `doc{title}`                                                 | one round: the skill it develops and the parts every attempt returns                                                        |
| `writers{task, skilled, rule}`                                                       | on a round: the wording its writers are given                                                                               |
| `using{provider, model, effort}`                                                     | on a round or a judge: the model asked (@yaks/session)                                                                      |
| `variant{body, theory, source, licence, from}` + `doc{title}`                        | a candidate text of the skill, installed nowhere                                                                            |
| `case{body, base}` + `doc{title}`                                                    | what a writer is handed; cases with one `base` are about one thing                                                          |
| `riddle{name, aliases, forbidden, forbidden_exact, group}`                           | on a case: a judge guesses what the attempt describes                                                                       |
| `found{name, source}`                                                                | on a case: something its maker published, kept to learn a judge's taste                                                     |
| `writing{round, case, variant, persona, run, model, at, ms, reply, output, session}` | what one writer returned, beside @yaks/model's `usage{input_tokens, output_tokens}` and `cost{dollars, reported}`           |
| `pair{round, a, b, ord}`                                                             | two attempts planned for comparison                                                                                         |
| `known{winner}`                                                                      | on a pair: its winner was settled when it was planned (a planted known answer)                                              |
| `held_out{at, by, via}`                                                              | on a pair: a person's tap on it is kept from every selector's examples                                                      |
| `preference{first, second, chose, judge, why}`                                       | one comparison; no `chose` is neither, no `judge` is a person's tap, by its `created.by`                                    |
| `grabbed{attempt}`                                                                   | its `created.by` found the attempt appealing on its own                                                                     |
| `judge{taught, form, shown, question, cap}` + `doc{title}`                           | an automated judge; `taught` when it was handed a person's taps as examples; one that guesses says how and what it is asked |
| `guess{attempt, judge, form, model, guesses, among, rank, cap, leaked, session}`     | one judge's guesses at a riddle attempt                                                                                     |
| `passing{share, at, by, via}`                                                        | on a round: how much of the known answers a judge must get right before its verdicts count                                  |

Variants, cases, attempts and what judges them are kept out of embedding, and
their text is in their own components, not `doc{body}`, so no agent meets a
candidate skill or a pitch unasked in a search.

A person's own attempt has no `variant`, `persona` or `model`: its writer is its
`created.by`. An automated judge writes the same `preference` rows a person does
and names itself in `judge`. A row that names no judge is read as a person's
tap, and a person's tap is an answer every judge is scored against, so a model's
row always names one.

```sh
yak trial load rounds/r1/round.json  # rows; loading again replaces them
yak trial run copy-r2 --cap 20       # ask the writers and judges it still owes
yak trial tally copy-r1              # what the round's rows say, as text
yak trial pass copy-r1 0.8           # what a judge must get right; a person's to set
yak trial hold copy-r1 0.25          # keep a quarter of the pairs from selectors
yak trial drop copy-r1               # the round and what only it used
```

A round file is JSON: `key`, `title`, `skill`, `output` (the parts), `persona`
(the id of the persona a `persona: true` writer carried), then `variants`,
`cases`, `attempts`, `judges`, `pairs`, `known` and `guesses`, each naming the
others by `key`, and for a round still to be run `using`, `writers` and `plan`
(`RoundFile` in ./skill.ts). The round is found again as `round:<key>`, a
variant as `variant:<skill>:<key>`, a case as `case:<skill>:<key>` and a judge
as `judge:<skill>:<key>` (@yaks/alias), so a later round's file reuses one by
naming its key, and one that restates it replaces its text. Give a changed
variant a new key and say what it came `from`. Attempts, pairs and guesses are
on eids derived from the round's key and their own. A guess that names no judge
is given the round's own guessing game in its form (`<round>.guess-open`).

### Running a round

A round's file can plan what nobody has written yet. An attempt with no `output`
and a guess with no `guesses` are planned rows, and `plan` writes them out: one
attempt for each case, variant, arm and run, and one guess of each for every
judge it names. A planned row is no attempt yet: the page and the tally leave it
out until it returns.

````jsonc
{
  "key": "copy-r2",
  "title": "Round two",
  "skill": "copywriting",
  "output": ["headline", "brief", "description"],
  "persona": "N-4053",
  "using": { "provider": "claude", "model": "sonnet" },
  "writers": {
    "task": "Write a pitch … as JSON in a ```json block with the keys \"headline\", \"brief\" and \"description\".$rule\n\n-----\n$case\n-----\n",
    "skilled": "You have been given a skill … \n-----\n$skill\n-----\n\nWrite a pitch …$rule\n\n-----\n$case\n-----\n",
    "rule": "\n\nThe sheet leaves out the company's name on purpose …"
  },
  "judges": [{
    "key": "headline",
    "title": "The headline alone",
    "form": "open",
    "shown": ["headline"],
    "cap": 10,
    "question": "Below is a pitch … Which company is it? … {\"guesses\": [\"...\"]}\n\n-----\n$output\n-----"
  }],
  "plan": {
    "variants": ["none", "candid"],
    "cases": ["make"],
    "personas": [false, true],
    "runs": 2,
    "judges": ["headline"]
  }
}
````

`yak trial run <round> --cap <dollars>` then asks what the round owes, `--jobs`
at a time (six by default): the writers, then the judges of what was written.

- **Every word is the round's.** A writer is given `writers.task`, or
  `writers.skilled` when its variant has a text, with `$case`, `$skill` and
  `$rule` filled in; `rule` is said only where the case is a `riddle`. A judge
  is given its `question` with `$output`, the parts it is `shown` (all of them
  where it names none). In the `among` form `$sheets` is the text of every case
  in the riddle's group under a letter, in an order the case decides, and `$n`
  how many. The runner holds none of the wording. It reads a reply as its last
  `` ```json `` block: an object with a key for each of the round's parts from a
  writer, `{"guesses": [names]}` from an `open` judge, `{"ranking": [letters]}`
  from one choosing `among`.
- **Each call is a session**, asked once and offered no tools
  (`sending{tools: []}`). @yaks/spawn starts such a run bare: none of its
  provider's tools, settings, instruction files, skills or MCP servers, in an
  empty directory. The persona arm differs by one thing: its session selects the
  round's persona, which reaches the provider through its instruction flag.
- **It says the cost first**: the mean of what earlier rows of the kind cost (a
  writer by arm, a judge by form) for each call owed, at list price. It asks
  nothing more once what it spent, with what the calls going are expected to,
  would pass the cap. `--cap 0` says the cost and asks nothing.
- **A row is written as its session ends**, with `usage` and `cost` summed from
  the session's requests. The row names its session in the write that asks, so a
  run stopped part way loses nothing: the next reads what each session said
  since and asks only what never returned. A reply with nothing readable is kept
  on the attempt as `reply`, and the next run asks again.

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

### Known answers

An automated judge earns trust the way a new reviewer does: answers already
settled are slipped in among the rest, unmarked, and the judge must get them
right before anything else it says is used.

A **known answer** is a pair whose winner is settled, and there are two kinds:

1. **A person's tap.** Every `preference` with a `chose` and no `judge` is one,
   from the moment it is written. A pair a person called neither, or that two
   people chose differently in, is not known.
2. **A planted pair.** A pair wearing `known{winner}`, such as something
   published set against a deliberately weak rewrite of the same facts. A round
   file lists them under `known`, the winner first, and the loader places each
   among the planned pairs. A person's tap on a planted pair outranks the plant.

`.pair .known` and `.preference !.preference.judge` tell known from unknown.
Nothing a judge is handed does: `deck(all, judge)` is the same cards for a
person and for an automated judge, each carrying that judge's own verdicts and
nobody else's.

**A judge's pick of a pair** is read from its own rows (`picker` in ./skill.ts):

- A judge that compares two attempts writes a `preference` naming itself, and
  its pick is the attempt it `chose`.
- A judge that scores one attempt at a time, like the guessing game, picks the
  attempt it was less far from right on: in the open form the one it guessed in
  fewer guesses, taking the mean over its guesses at each and counting a miss as
  its cap plus one; in the among form the one it picked right more often. So the
  guessing game sits a known pair only when it has guessed at both of its
  attempts, and both must be attempts at a `riddle` case.
- Neither, or the same score for both, is a verdict that agrees with no answer.

A judge **passes** a round when its pick is the winner on at least the round's
`passing{share}` of the known answers it sat. That share is a person's to set
(`yak trial pass <round> 0.8`), and the tally says who set it. With no share
set, or no known answer sat, no judge has passed. Nothing is refused on a
failure: the tally prints the judge apart.

**Held out.** A selector is a judge built from a person's taps
(`judge{taught:
true}`), so those taps cannot test it.
`yak trial hold <round> <share>` marks that share of the round's pairs
`held_out`, choosing among pairs nobody has tapped yet, so the split is rows
written before the taps and is the same on every run. `examples(all, person)` is
what a selector is handed: that person's taps less every held-out pair's. A
taught judge is scored only on planted pairs and on taps of held-out pairs.

### The tally

The tally first counts a person's taps, for each variant, persona arm and case:
attempts, comparisons shown, preferred, neither and grabbed. Then:

- the round's known answers, how many pairs are held out, and the passing share;
- each judge: how many known answers it sat, how many it agreed on, and whether
  it passed, failed, is untested or has no passing share to meet;
- each judge that passed, with its verdicts on the pairs that have no known
  answer (`judged`, `picked`) and, for a guessing judge, its mean guesses until
  right (a miss counts as its cap plus one), how often a pick among the group
  was right, and whether the variants a person preferred are the ones it guessed
  soonest (Spearman's rho over the variants that have both);
- every other judge the same way under "Not to be used", apart;
- each attempt that grabbed, and each why.
