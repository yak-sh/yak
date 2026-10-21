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
- `plans`: by the provider whose plan the requests billed against, the dollars
  they ran up on it, in all and by part, session, task, model and entry. A
  request the native harness sent bills its `using` provider's plan (Claude's
  CLI Claude's; Codex's CLI, and OpenAI signed in with ChatGPT, Codex's); one
  read from a Claude Code transcript or a Codex rollout bills that CLI's; a
  request paid by the token (OpenRouter, OpenAI with an API key) bills none
  (`PLANS`, `planOf` in ./day.ts).

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

## The duty and the tools

`@yaks/spend/service` is a duty: every ten minutes it tallies today again (and
yesterday, for the first hours of a day), and keeps the Claude plan's newest
limits as `rate_limit` rows, read from the cache claude-status writes
(`~/.cache/claude-usage`, or `$CLAUDE_USAGE_DIR`). Codex's limits arrive with
its sessions. Options: `every` (milliseconds) and `usage` (the cache directory).

- `yak spend show [since] [--until day] [--top n]` reports a span of days, by
  default the Claude plan's week.
- `yak spend backfill <since>` measures the requests of every transcript,
  managed run and graph session written since a day (@yaks/session and
  @yaks/spawn `recounted`), then tallies each day.

## The page

`./views` offers the browsing app a `Spend` page in its sidebar (`/?spend`):
each plan limit against its pace, then the week's tally beside the week before,
ranked by dollars, over the list of days. A day's row opens to that day's tally.
The bars are @yaks/ui's `Meter`.

Beside each row's dollars, its **week %** estimates what it cost on a
subscription: its share of each plan's weekly limit. `rates` measures a plan's
dollar from its newest weekly reading (`rate_limit`, the percent Claude's
claude-status and Codex's rollouts report) over the dollars, at list price, its
requests ran up from the day the week began to the day of the reading. A row
that billed two plans says each share apart; one paid by the token says so. A
`call <tool>` or `result <tool>` part links to the calls or results it was made
of in the span (`partQuery`, @yaks/session/parts).
