# Claude usage accounting

Claude costs about eight cents per API request in the measured period. A session
makes 171 requests on average, so it costs $13.66. The eight-cent task target is
the cost of one request at the present model, context and effort.

The 55 fresh starts cost $9.77 in five-minute cache writes alone, averaging 18
cents per first request before output. Reducing the number of requests alone
cannot reach eight cents per task at this startup cost.

## Billing

The [sanitized measurement](claude-cost-data.json) contains every session and
its explicitly claimed tasks. It includes no transcript text or commands. All
dollars are Anthropic API equivalents, not subscription charges or a conversion
of Claude Code's weekly percentage. The subscription's quota formula is not
available in these transcripts.

| Local period (America/Detroit) | API equivalent | Sessions | Requests | Dollars/request |      Dollars/completion |
| ------------------------------ | -------------: | -------: | -------: | --------------: | ----------------------: |
| Oct 27 18:00–Oct 29 00:00      |        $819.61 |       60 |   10,239 |         $0.0800 | $14.64 (56 completions) |
| Oct 28                         |        $778.36 |       56 |    9,838 |         $0.0791 | $15.88 (49 completions) |
| Oct 29, through 13:53 UTC      |         $12.35 |        5 |       95 |         $0.1300 |   $4.12 (3 completions) |
| Oct 20 00:00–Oct 27 18:00      |      $3,053.97 |      343 |   42,855 |         $0.0713 |             not counted |

Completions measure Task Graph throughput, not independent human requests. The
denominator query is
`.task .filed.project=P-19 .completed.at>=<since>
.completed.at<<until> .count`,
with the same exclusive end as the cost window; the measurement stores the
completed task IDs and timestamps. The cost numerator covers all available local
transcripts, including work in progress and tasks completed outside the period.
Today also includes $2.48 outside the operator family, so dollars/completion is
local spend divided by project throughput, rather than a matched task bill.
Today's three completions are bug tickets for one fix. The 27 sessions with
exactly one explicit task assignment have a median measured task cost of $13.25,
mean $15.64, and range $0.15–$48.47; these are period costs, not necessarily the
complete lifetime of each task. Multi-task sessions are not arbitrarily split.

The expensive single-task examples are T-132914 ($48.47), T-132912 ($46.39),
T-132879 ($37.65), and T-132878 ($27.79). The largest session is
agent-a2ff4121ddd5fbe17: $80.06 over 548 requests for several tasks.

## Causes

All 10,239 requests in the primary period use Opus 5.5 at xhigh effort. Exact
billing shares are:

| Billed component                                | Dollars |  Share |
| ----------------------------------------------- | ------: | -----: |
| Reading cached context: 2.022 billion tokens    | $404.49 | 49.35% |
| Five-minute cache writes: 53.106 million tokens | $265.53 | 32.40% |
| One-hour cache writes: 1.679 million tokens     |  $13.43 |  1.64% |
| Thinking: 3.639 million output tokens           |  $72.78 |  8.88% |
| Other output: 3.165 million tokens              |  $63.30 |  7.72% |
| Uncached input                                  |   $0.08 |  0.01% |

Of the 10,239 requests, 199 (1.94%) follow a gap of more than five minutes
between request starts. They incur $177.59 of five-minute cache writes, 66.88%
of that category and 21.67% of the whole bill. The other 9,985 continuing
requests incur $78.16; 55 first requests incur $9.77. This supports cache expiry
during slow commands, waits or model generation as a large contributor, though a
gap alone does not prove which prefix expired. A longer TTL trades dearer writes
against fewer rewrites and needs a measured comparison; changing Claude's cache
policy is outside these repository fixes. The gap calculation orders each
session's API request timestamps and compares consecutive starts, using all
prior history to identify first requests.

Thinking is a subset of output, not an extra charge. Median context per request
is 190,093 tokens; the 90th percentile is 350,192, maximum 466,961. Most
sessions begin near 40,000 tokens, then accumulate conversation and tool
results. Fifty-five of sixty first observed contexts are below 43,000 tokens;
large inherited operator histories are not the usual starting condition.

The operator ac7184a3-f341-4697-a8a7-b4ea0984c0db itself costs $21.87, 2.67%.
Its 59 descendant sessions cost $797.74, 97.33%; that group contains all the
measured task work, so the family percentage does not imply operator overhead.
Today's operator cost is $9.21 of $12.35, with another $0.65 in descendants.

Prompt sections do not have token counters. Distributing each request's billed
input cost by its reconstructed character proportions gives approximate shares
of the total bill: assistant history 18.20%, CLAUDE/global instructions 18.01%,
repository skill catalogues 7.58%, other skill-bearing blocks 7.45%, tool
schemas 7.15%, Bash output 7.15%, Read output 1.23%, test output 0.15%, and our
hooks 0.07%. Other user messages/reminders account for 11.81%; CLI environment
and system prompts account for another 3.66%. These are estimates, not
per-section token measurements. Different token density and cache-prefix
placement can change the allocation.

Startup snapshots for the operator and one task agent carry 299–301 deferred MCP
tool names (about 10,300 characters), loading no MCP schemas initially. That
task agent later loads five MCP schemas: 8,339 serialized characters, 28.1% of
its loaded schema characters; the remainder is built-in tools. These are scoped
snapshots, not another exact cost share.

Bash supplies about 91% of recorded tool-result characters on Oct 28, but tool
results are only part of the prompt and the bill. Large outputs include whole
source files read with cat, git show followed by cat of the same file, and bug
reports. Bash output is not the dominant billed category. SessionStart and
SubagentStart blobs bundle Claude's environment, deferred tool roster and skills
alongside our hook prefix; charging that entire blob to the hook would
incorrectly make the hook look expensive.

## Changes and projections

The repository's 23 skill descriptions shrink from 19,306 to 6,669 characters,
65.5% less, while preserving names, trigger domains and skill instructions. A
recorded task-agent startup catalogue has 19,777 characters including names,
prefixes and line breaks; the shorter catalogue has 7,101, a 64.1% reduction.
Applying that reduction to the primary period's $62.14 catalogue input
allocation estimates a $39.83 saving, 4.86% of the total: $14.64 per completion
becomes $13.92. Today's replay is $4.12 to $4.01 per completion. These estimates
hold request count and generated tokens constant. They apply to fresh
catalogues; a running conversation still contains the old listing until its
context is replaced.

`yak admin errors` and `admin_errors` return unresolved work by default.
`--resolved` or `resolved: true` explicitly requests resolved history. The
captured live report shrinks from 101,007 to 11,454 characters: 89,553 fewer
characters, or 88.7%. Historical model-visible outputs were often truncated, so
that raw saving is not multiplied into the historical dollar projection. No hook
change is justified by its measured share.

The audit command also defaults to a bounded summary, with full details behind
`--json`. The sanitized primary-period report is 52,343 characters as JSON and
576 characters in the summary (18 lines), saving 98.9% of default output. This
is a saving on future diagnostic calls, not part of the historical projection.

Jeff's choices remain recommendations: using Sonnet 5.5 at the same token counts
halves the primary period's bill, saving $409.80, with quality and turn count
left unmeasured. Halving context at the same request count would save about
$341.77 (41.7%). Eliminating measured thinking generation would save $72.78
directly (8.88%), before effects on context or request count; a lower effort
setting's effect on total work needs an experiment. Avoiding unnecessary
investigation/reverification turns addresses the multiplication by 171
requests/session. None of those preferences changes in this task.

## Reproduction

The default command prints a bounded summary so the diagnostic does not fill its
own conversation with output. Use `--json` for the full report; it includes
local command examples, so remove `largestOutputs` before sharing or committing
a result:

```sh
deno run -A bin/claude-cost.ts --json 2026-10-27T22:00:00Z 2026-10-29T04:00:00Z > /tmp/claude-cost.json
```

For a single-line JSON cache, project the needed fields with `jq` or a JSON
parser; `head` can still print the complete record.

For today's fixed snapshot use the start `2026-10-29T04:00:00Z` and end
`2026-10-29T13:53:00Z`; the end is exclusive.

The script reads project JSONL files and `/tmp/claude-1000` output files,
canonicalizes symlinks, and globally deduplicates assistant message IDs. One API
response can appear in multiple streamed content blocks or copied fork
histories. The originating request wins over copied history; cumulative final
usage wins within that request. Different child requests are still charged for
their own cache reads. `.output` mirrors add no unique requests in this period.
Only explicit CLI or MCP task claims, completion calls and assignment prompts
identify tasks; incidental task references do not assign cost. A session that
claims or completes several tasks is left unsplit.

API request records reconstruct the sent message sequence with `keep` plus
`tail` blob hashes and the recorded shape's system/tools. Character allocation
covers $683.47 of $683.53 input cost. Source transcripts are private and remain
outside git. Six small tests check billing, deduplication, bounded summaries,
task assignment and flag positioning without reading private transcripts.

[Anthropic's pricing](https://platform.claude.com/docs/en/about-claude/pricing)
sets Opus 5.5 per million tokens at $4 input, $20 output, $5 five-minute writes,
$8 one-hour writes, and $0.20 cache reads. Sonnet 5.5 rates are half
those amounts. The script selects the model each message names, rejects
unknown models, and handles recorded US inference and fast-mode multipliers.
The baseline contains Opus 5.5 ($3,019.29), Sonnet 5.5 ($34.57), and Haiku 5.5
($0.11). No server or Chrome is started for this analysis.
