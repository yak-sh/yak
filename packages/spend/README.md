# @yaks/spend

Where model tokens go. Every model request an agent makes here is an entry in
the graph with its `usage` (@yaks/model) and, where the importer or the native
runner recorded it, its `context_parts` (@yaks/session/parts): its input laid
out part by part in the order it was sent, and the provider's measured totals
split across the parts by their sizes. This package tallies those requests into
one row per UTC day and draws the tallies, so looking at where the tokens went
reads a few rows and spends nothing.

A **part** is one piece of what a request carried: a piece of the fixed part
every request of a session carries (`system`, `tool <name>`, `persona <id>`,
`skills`, `mcp instructions`, …, from the session's `fixed`), or a kind of
conversation (`input`, `output`, `reasoning`, `notice`, `checkpoint`,
`call <tool>`, `result <tool>`). A part is paid for on every request it rides
in, as it was paid that time: read from the provider cache, written to it, sent
fresh, or generated. A request whose context was not recorded is one part,
`unrecorded`.

## The tally

A day's tally is a `spend` row on an eid derived from its `day`, holding its
`requests`, its `tokens` and `dollars`, and:

- `parts`: `[read, written, fresh, generated, dollars]` by part;
- `sessions`: `[tokens, dollars, requests]` by session;
- `tasks`: `[tokens, dollars]` by task, each session split evenly across the
  tasks it claimed, commented on, filed or finished that day or the next, and a
  subagent across the tasks its brief names, else as the session that started
  it;
- `models`: `[read, written, fresh, generated, dollars, requests]` by model;
- `entries`: `[tokens, dollars]` for the fifty transcript entries that cost most
  as they were carried request after request.
- `plans`: by the account whose plan the requests billed against
  (`account{home, provider}`, @yaks/model), the dollars they ran up on it, in
  all and by part, session, task, model and entry. A request read from a Claude
  Code transcript or a Codex rollout bills the account whose directory holds it;
  one the native harness sent bills the account its `using` provider's CLI signs
  in with here (Claude's CLI Claude Code's; Codex's CLI, and OpenAI signed in
  with ChatGPT, Codex's); a managed run's transcript is its command's output, in
  no account's directory, so its requests bill the account of the provider its
  session asked for; a request paid by the token (OpenRouter, OpenAI with an API
  key) bills none (`PLANS`, `planOf` in ./day.ts).

Dollars are what the provider reported, else the tokens at the model row's
`price`. The totals are measured; the split across parts, and across a session's
tasks, is estimated.

```ts
import { merged, tally } from '@yaks/spend'
import { equal } from '@yaks/testing'

let ask = {
  entity: { eid: 'a' },
  entry: { session: 's' },
  ask: { to: 'm' },
  usage: { input_tokens: 1000, output_tokens: 10 },
  context_parts: { parts: { input: [0, 0, 1000, 0], output: [0, 0, 0, 10] } },
}
let day = tally('2026-10-20', [ask], {
  prices: new Map([['m', { input: 4, output: 20 }]]),
  fixed: new Map(),
  tasks: new Map(),
})
equal(merged([day, day]).parts.input, [0, 0, 2000, 0, 0.008])
```

A request whose model has no `price` and which reported no dollars is weighed at
nothing, and its model is named in the tally's `unpriced` (and its plan's): what
it cost is missing, not zero. The duty tells the tracker of each such model once
while the server runs. The page says `unpriced: <model>` in place of that
model's dollars and of any week % or "1% of it is about" built on a plan whose
week holds one. Give the model a `price` row and the next tally heals it.

## The duty and the tools

`@yaks/spend/service` is a duty: every ten minutes it tallies today again (and
yesterday, for the first hours of a day), and keeps the Claude plan's newest
limits as `rate_limit` rows, read from the cache claude-status writes
(`~/.cache/claude-usage`, or `$CLAUDE_USAGE_DIR`): the limits of the account
`yak serve`'s environment signs in with, or of the one a `CLAUDE_CONFIG_DIR=`
line in the reading names. That cache is filled by an interactive session's
status line alone. A `claude -p` run reports the same limits in its own stream,
and they arrive with the run (@yaks/session's `claude` reader), so the readings
stay fresh with nobody in Claude Code. Codex's limits arrive with its sessions,
each account's with its own. Options: `every` (milliseconds) and `usage` (the
cache directory).

`@yaks/spend/graph` is what marks a day `untallied`: a request written after its
day ended, as every request of a transcript read in after the fact is, marks its
day's row in the same transaction, and the duty tallies every marked day within
a minute. So the first `yak serve` on a machine with months of Claude Code and
Codex transcripts fills every one of those days as the transcripts are read,
with no command. The duty takes the mark off before it tallies the day, so a
request arriving during the tally marks the day again.

- `yak spend show [since] [--until day] [--top n]` reports a span of days, by
  default the Claude plan's week. A day is written in the time grammar
  (@yaks/vocab `timeSpan`): `2026-10-13`, `yesterday`, `3 days ago`.
- `yak spend backfill <since>` measures the requests of every transcript,
  managed run and graph session written since a day (@yaks/session and
  @yaks/spawn `recounted`), then tallies each day.

## A topic's share

A topic can have a share of each plan's week (`attended{share}`,
[@yaks/topic](../topic)). `shared(graph)` from `@yaks/spend/tools` reads how
much of each share is used, and `yak spend show` prints its rows, a line each:

```
Q-12 Funnel keeps 7.5% of each plan's week (its 10% less 2.5% given below): claude 4.1% used ($118 of usage at list price), 30% of its week gone
```

- A session's dollars are charged to the topic it was opened on
  (`session.topic`), else to the topic the session that started it
  (`spawned.parent`) is charged to, up its line however long. A topic with no
  share passes them to the nearest topic above it that has one.
- On each plan with a weekly limit, the dollars are those of the plan's running
  week, turned into a part of that week by the plan's rate (`rates`), beside how
  much of the week is gone (`paceOf`). A plan read before its week turned has no
  rate, and says so.
- The last row is the work no share covers, against the part of the week no
  topic was given.

The dollars are usage at list price: a plan is a subscription, so they measure
use and are not cash. Nothing here is stored. Where no topic has a share,
nothing is read and nothing is printed.

## The page

`./views` offers the browsing app a `Spend` page in its sidebar (`/?page=spend`,
which `./routes` also answers at `/spend`, the address `yak serve` prints when
it starts): each account's plan limits against their pace, what each account ran
up this week beside the total, then the week's tally beside the week before,
ranked by dollars, over the list of days. An account is named by its provider
where the provider keeps one, else by its directory (`.claude-work`). A day's
row opens to that day's tally. The bars are @yaks/ui's `Meter`.

Beside each row's dollars, its **week %** estimates what it cost on a
subscription: its share of each plan's weekly limit. `rates` measures a plan's
dollar from its newest weekly reading (`rate_limit`, the percent Claude's
claude-status and Codex's rollouts report) over the dollars, at list price, its
requests ran up from the day the week began to the day of the reading. A row
that billed two plans says each share apart; one paid by the token says so. A
`call <tool>` or `result <tool>` part links to the calls or results it was made
of in the span (`partQuery`, @yaks/session/parts).
