# Self-documenting CLI — declare the verb, generate the manual (T-12869)

`task spawn --help` prints this and stops:

```
task spawn <id> [--provider=X] [--model=Y] [--effort=Z] [--persona=P-9]
```

It cannot say which models are accepted, that `--effort` has a default, or that
the short aliases are the ones to reach for — not because nobody wrote it down,
but because there is nowhere in the declaration for that to BE written. `Opt`
(`src/manual.ts:9-14`) holds a name, a regex and an error phrase; the shape a
caller reads is a hand-typed string in a different field. T-12867 is the
symptom; this is the shape underneath it.

The ask is Thor's: declare the parameters as data and let usage, `--help`,
validation and completion all be renderings of that one declaration.

## Four lists, one vocabulary

Every verb is described four times, and nothing derives from anything:

| # | where                                   | what it says             | who reads it |
| - | --------------------------------------- | ------------------------ | ------------ |
| 1 | `manuals[n].usage` (`manual.ts:53+`)    | the shape, as prose      | humans       |
| 2 | `manuals[n].options/.words/.check`      | the shape, as data       | `validate()` |
| 3 | the handler in `cli.ts`                 | the shape, a third time  | dispatch     |
| 4 | `commands[n].args` (`commands.ts:143+`) | the shape, as an example | `ghost()`    |

List 3 is the largest and least visible: **39 sites in `cli.ts` re-find their
own flags** after `validate()` has already walked them —
`args.includes('--json')`, `args.find(a => a.startsWith('--verdict='))`,
`args[args.indexOf('-n') + 1]`. Each is a second parser with its own idea of the
grammar.

### What has already drifted

- **`task spawn`** (`manual.ts:315-330`, handler `cli.ts:962-977`): four options
  declared as `value('--provider')` — accept `/.+/`, want "a value". The
  allowlists they are checked against live in `adapters.ts:241-263` and are
  never shown. The handler then re-parses all four with a local `flag()`, and
  re-throws the usage string verbatim (`cli.ts:967-970`) for a missing `<id>`
  that `words: [1, 1]` already rejects.
- **The drift is already shipped and teachable.** `task spawn --help` prints, as
  its second example:

  ```
  task spawn T-3 --provider=codex --model=gpt-5.4
  ```

  `gpt-5.4` is not a codex model. The allowlist is
  `['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']` (`adapters.ts:450`), and
  `trouble()` (`adapters.ts:143-145`) refuses anything outside it. The manual
  teaches, by example, a command that cannot run — and nothing could have caught
  it, because no edge connects the prose to the list. Under this design the same
  line is unwritable: `--model`'s values ARE the allowlist, so the example
  either names a live model or fails its own validation.
- **`task history`** defaults `-n` to **50** (`cli.ts:1184`). The manual does
  not say so, because `Opt` has no field for a default.
- **`task probes`** defaults `--grace` to **30 minutes** (`cli.ts:1734`). The
  manual says so — in hand-written prose (`manual.ts:500`), 200 lines from the
  code that decides it.
- **`manual_test.ts:22-27`** asserts `manual.usage.includes(option.name)`. That
  test exists only to keep lists 1 and 2 agreeing. Generate one from the other
  and it has nothing left to check.

## The declaration

One module owns the vocabulary; `manual.ts` keeps the table and the help
routing. Split because the table is already 811 lines and will only grow.

```ts
// src/verb.ts — what a verb IS. No table lives here.

// What a value may be: the phrase a refusal says, the test it must pass,
// and — when the set is finite — the values themselves. Finiteness is the
// whole trick: one field teaches, validates and completes.
export type Kind = {
  want?: string                    // derived from `values` when absent
  test?: (v: string) => boolean
  values?: () => string[]          // everything accepted
  offer?: () => string[]           // what help LEADS with, when accepted is long
}

export let text: Kind = { want: 'a value' }
export let id: Kind = { want: 'an id, alias or eid' }
export let path: Kind = { want: 'a directory' }
export let body: Kind = { want: 'text, @file, - or @-' }
export let num: Kind = { want: 'a positive number', test: v => /^[1-9]\d*$/.test(v) }

// A finite set. Thunks, so `--help` pays for no list it doesn't print and
// a live table (adapters, comps) is read at the moment of asking.
export let of = (values: () => string[], offer?: () => string[]): Kind => ({
  test: v => values().includes(v),
  values,
  offer,
})

// The graph's own type language, borrowed: `.verdict=` and `--verdict=`
// then cannot mean different sets (types.ts PropType).
export let enumOf = (t: PropType): Kind => ...
```

`want` is a function of the Kind rather than a field on it, so an enum never
states its values twice:

```ts
export let want = (k: Kind) =>
  k.want ??
    (k.values ? `one of ${(k.offer ?? k.values)().join(', ')}` : 'a value')
```

Positionals and options:

```ts
export type Arg = {
  name: string // the metavar — id, words, to
  kind?: Kind
  eg?: string // a concrete sample; what the palette ghosts (below)
  many?: boolean // takes the rest
  opt?: boolean
}

export type Opt = {
  name: string // --json, -n
  kind?: Kind // absent = a flag
  about?: string // one line, for the options block
  or?: string // the default — APPLIED at parse and PRINTED in help
  need?: boolean // required (mail send --body)
  separate?: boolean // '-n 5' as well as '-n5' / '--out=x'
}

export type Verb = {
  about: string
  args?: Arg[]
  opts?: Opt[]
  some?: string[] // at least one of these must be given (below)
  detail?: string
  examples?: string[]
  root?: boolean
  alias?: boolean
  deprecated?: string
  retired?: Record<string, string>
  usage?: string // escape hatch: syntax, not a verb — `subject`, `:`
  run?: (got: Got) => unknown
}
```

Three fields of today's `Manual` are gone, each because it is now derived:
`usage` (rendered from `args`/`opts`), `words` (min = required positionals, max
= `many ? ∞ : count`), `check` (see `some`, below).

`or` is the field T-12867 needs: `opt('--effort', of(efforts), { or: 'high' })`
is simultaneously the default the parse applies and the default the help prints.
Today those would be two facts in two files.

## Usage is generated

```ts
let slot = (a: Arg) => a.many ? `${a.name}…` : a.name
let arg = (a: Arg) => a.opt ? `[${slot(a)}]` : `<${slot(a)}>`
let opt = (o: Opt) =>
  !o.kind ? o.name : o.or ? `${o.name}=${o.or}` : `${o.name}=${meta(o)}`
```

`meta` spells a value set inline when the joined set is ≤ 24 characters,
otherwise prints the metavar and leaves the values to the options block. The
usage line is a **shape** and must stay one line; the block is the
**reference**. Worked against today's table:

```
task history <id> [-n=50] [--json]
task mail files <id> [--out=DIR]
task comment <id> [text…] [--verdict=approved|rejected|changes_requested]
task spawn <id> [--model=MODEL] [--effort=high] [--persona=P-9]
```

`comment` keeps its inline verdicts (39 chars — over budget, so this is the one
place to confirm the threshold or let it wrap). `spawn` cannot spell nine models
on a line, so `MODEL` stands in and the block carries the list. That is the case
the whole design is for.

Two entries are syntax rather than verbs — `subject`, whose usage is
`<id> [show|is|as|edge] …`, and `:`, whose usage names both colon forms. They
keep a literal `usage` string. The escape hatch exists for exactly those two and
this paragraph says so, so a third use is a design question rather than a habit.

`role`'s current line (`role [--json] | role <stop|start> <id>… | --all`)
generates as `task role [--json]` with `role stop` / `role start` listed in the
children block that already renders below it. That is a visible change and an
improvement: the alternation was hand-maintaining what the children block prints
anyway.

## Help has one shape

Always this order, each section omitted when empty — null is a first-class
render here as it is in the UI registry:

```
task spawn <id> [--model=MODEL] [--effort=high] [--persona=P-9]
  dispatch a managed agent onto a task

  <id>         the task to work
  --model      opus, sonnet, haiku, fable — also accepts the pinned ids
  --effort     one of low, medium, high, xhigh — default high
  --persona    a persona entity (id or alias)

  task spawn T-3
  task spawn T-3 --model=opus
```

Order: usage, about, `Deprecated:`, children, **args + options**, detail,
examples. Only the middle block is new; the rest is `render()`
(`manual.ts:627-640`) unchanged.

## Where accepted values come from — and why `--help` still works offline

`--help` must never need the server: a caller reaching for help is often a
caller whose server is down. So value sets are **static imports**, never
fetches.

`adapters.ts` imports `types.ts` and a type-only `LogRow` from `transcripts.ts`
— no db driver, so `cli.ts` may import it without breaking the rule at
`cli.ts:100-101` that keeps `node:sqlite` out of the CLI.

The provider table already draws exactly the distinction help needs, and says so
in its own comment (`adapters.ts:253-257`): `models` is everything accepted,
`labels` is "the MENU — aliases only, first entry is the house default". That
maps onto `Kind` with nothing invented:

```ts
opt('--model', of(models, aliases), { about: 'also accepts the pinned ids' })
```

`offer` is what the help leads with, which is T-12867's "should encourage
aliases", already true in the data and merely unprinted.

Graph-typed options read `comps` through `enumOf`, so `--verdict` and
`.verdict=` cannot disagree. **This widens `--verdict`**: the graph enum carries
input aliases (`approve`, `reject`, `changes` — `types.ts:75-79`) that the CLI's
hand-written regex rejects today. Widening is right — one vocabulary, two
spellings of the same door — but it is a behavior change and belongs in the
commit message.

## What `parse()` hands the handler

Validation currently throws and discards what it learned; the handler then
parses again. Return it instead:

```ts
export type Got = {
  args: Record<string, string | string[]> // by Arg.name
  opts: Record<string, string | true> // by Opt.name, defaults applied
  rest: string[] // after `--`
}
```

`spawn`, whole, once the declaration carries the shape:

```ts
let spawn = (got: Got) => launch(String(got.args.id), got.opts)
```

Fifteen lines become one; the local `flag()`, the duplicate usage throw, and the
third parse all go. This is the test STYLE sets for an abstraction — it must
remove code from callers — and 39 re-parse sites is the measure.

Dispatch follows: with `run` on the declaration, `cli.ts`'s 40-arm `if/else`
(`cli.ts:2108-2145`) becomes `verb.run(got)`, and "declared but unrouted" stops
being possible. The `listing()`/`subject()`/`:` sugar stays as a router in front
of the table, unchanged.

## The five `check` callbacks become one field

Every current `check` is the same sentence — "at least one of these":

| verb              | today                              | `some`                   |
| ----------------- | ---------------------------------- | ------------------------ |
| `mail send`       | `--body` present                   | `--body` is `need: true` |
| `mail reply`      | `words.length > 1 \|\| --body=`    | `['text', '--body']`     |
| `comment`         | `words.length > 1 \|\| --verdict=` | `['text', '--verdict']`  |
| `session brief`   | `words.length \|\| --body=`        | `['text', '--body']`     |
| `role stop/start` | `words.length \|\| --all`          | `['ids', '--all']`       |

Note what the `> 1` was doing: counting past the positional `<id>` by hand. With
named args the off-by-one cannot be written.

All five fit, so **`check` is deleted rather than kept as an escape hatch** —
STYLE's "don't build the speculative layer", with this paragraph standing where
the layer would have been. A sixth shape that doesn't fit `some` is a signal to
extend `some`, not to reopen the callback.

## How far the `:` convergence honestly goes

"CLI sub-commands should simply be sugar for the `:`-commands" holds for write
verbs and does not hold for the rest. The split is not arbitrary:

- A `:` command is `(line, ctx) => Result` — **pure**, returning intent
  (`changes` / `go` / `spawn` / `msg`). No IO, which is why every one is a table
  test (`commands.ts:1-20`).
- Read verbs (`list`, `show`, `search`, `inbox`, `telemetry`, `history`,
  `probes`) return **rows**, which `Result` has no room for. Shell verbs (`tui`,
  `claude`, `codex`, `backup`) exec a process. Forcing either through `Result`
  means widening it to carry data and effects — a speculative layer that buys
  one shared word and costs the purity that makes the table testable.

So two things unify and one deliberately does not:

1. **The declaration** unifies completely. A `:` command and a CLI verb are both
   a `Verb`; both render help through one renderer; both validate through one
   parser. This is the whole "same system" ask and it costs nothing.
2. **Write verbs converge on the `:` runner.** `task claim T-3 sess` becomes
   sugar for `T-3 :claim sess`; the same for `new`, `set`, `comment`, `wake`,
   `spawn`, `mail send`. `colon()` (`cli.ts:985-1010`) already spends a `Result`
   the CLI way — fetch snapshot, `send()` the changes, print `msg`, launch a
   `spawn`, print a `go` as a URL — so the CLI handler shrinks to a `Got` → line
   translation and the graph behavior has one owner.
3. **Read and shell verbs stay CLI-only**, sharing the declaration and nothing
   else. Named here so the absence reads as a decision.

## Completion

`complete(argv)` walks the same table and is the only completion source:

- word 0 → root verbs, plural kinds, `:` commands
- a verb with children → its children
- a word opening `--` → its options, minus those already given
- after `--model=` → `values()`
- a positional of kind `id` → a hook the CLI fills from a snapshot; help and
  validation never call it, so they stay offline

The palette's `ghost()` stops regexing prose. Today it recovers slots with
`cmd.args.match(/\[[^\]]*\]|\S+/g)` (`commands.ts:549`) — guessing at an example
string. With `Arg[]` the slots are given.

**`eg` is what keeps this from being a regression.** `:mail`'s args today read
`jeff subject… -- body…`, and the ghost paints those concrete words — `jeff`
teaches faster than `<to>`. So `Arg` carries both: `eg ?? name` for the ghost,
`<name>` for the usage line. Six call sites read `Command.args` as a string
(`manual.ts:648,799,808`, `commands.ts:478`, `mcp.ts:567`, `Status.tsx:402`,
`Comments.tsx:203`) and each needs the same one-line change.

## What this deletes

- 47 hand-written `usage:` strings, and every drift they can hold
- `words` on every verb (derived), `check` on five (declarative)
- the `usage`-mentions-`options` test (`manual_test.ts:22-27`) — nothing to
  police once one side generates the other
- the 40-arm dispatch chain
- 39 re-parse sites, and the handler-local defaults (`-n` 50, `--grace` 30) that
  `--help` cannot currently see

## Staging

Each stage lands green on its own.

1. **`verb.ts` + the table.** Types, `usage()`, `parse()`. Convert `manuals` to
   `args`/`opts` data. Tests: a usage snapshot per verb; every existing case in
   `manual_test.ts:73-111` still refused, with its message updated where the
   generated phrasing differs; and — **the one that would have caught
   `gpt-5.4`** — every `examples[]` line parsed through its own verb and
   asserted valid. A manual that teaches by example should not be able to teach
   a command that cannot run.
2. **`Got` reaches the handlers.** Delete the re-parsing; dispatch by table.
   Handler-local defaults move into `or`.
3. **`commands.ts` adopts `Arg[]`.** `ghost`/`suggest` read slots; `eg` carries
   the concrete samples; the six string call sites move. One renderer for both
   vocabularies.
4. **Write verbs become `:` sugar.** `claim`, `set`, `new`, `comment`, `wake`,
   `spawn`, `mail send` route through `commands`.
5. **`task complete`** and the shell scripts. Its own task — the seam is what
   this design owes it.

**T-12867 lands on stage 1 alone**: `--model` gains `of(models, aliases)`,
`--effort` gains `or: 'high'`, and `--provider` can be dropped once the model
names identify their adapter (they are disjoint across `claude` and `codex`
today — worth an assertion in `adapters_test.ts`, since the drop makes
disjointness load-bearing).

## What changes visibly

- `role`'s usage line loses its hand-written alternation (children block already
  prints it).
- Four hand-written refusals converge on one generated phrasing — e.g.
  `needs
  reply words, @file, or --body=@file|-|@-` becomes
  `needs <text> or
  --body=<text, @file, - or @->`. Consistency is the ask; the
  substring assertions in `manual_test.ts:82-85` move with it.
- `--verdict` accepts the graph's input aliases.
- `--help` gains an options block everywhere, which is most of the point.

## Decisions to confirm

1. **The 24-character inline threshold.** A length rule is technically an
   inconsistency in a design whose ask is consistency. The alternative — never
   spell values on the usage line — is more uniform and strictly less helpful
   for `--verdict` and `--gone`-style small sets.
2. **`or` as the name for a default.** Reads well at the call site
   (`{ or: 'high' }`), and `default` is the unambiguous alternative.
3. **Stage 4's reach.** `task set <id>` names its target while `:set` uses
   focus, so the sugar is `<id> :set …`. Worth confirming that every write verb
   should route through `commands` rather than only those with an existing `:`
   twin.
