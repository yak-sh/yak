# @yaks/tracker

An **error** is one occurrence of a mistake; a **bug** groups errors with the
same fault. Intake keeps a reporter's UUID so a queue or spool resend is the
same occurrence. Grouping runs downstream and atomically links and counts it.
All references may name entities in other stores.

| Export      | Owns                                                        |
| ----------- | ----------------------------------------------------------- |
| `.`         | Fault keys, grouping patches, regression and retention      |
| `./vocab`   | Tracker words, RAM computations and SQL-derived expressions |
| `./report`  | `report`, `caught`, `capture`, `queue`, `spool`, `post`     |
| `./page`    | Classic browser capture script and twenty breadcrumbs       |
| `./effects` | `error_group`, `bug_notify`, `error_trim`                   |
| `./views`   | Bug pages, list rows, error frames and the Bugs destination |
| `./tools`   | `bug_list`, `bug_show`, `bug_resolve`, `bug_archive`        |
| `./service` | Spool record admission and acknowledgement                  |

```ts
import { normalize } from '@yaks/tracker'

normalize('T-42 failed at /srv/app.ts:10:3 after 300 tries')
// '# failed at # after # tries'
```

## Host interface

Load `trackerDoc` with @yaks/kernel, @yaks/tools, @yaks/api, @yaks/doc,
@yaks/mail and @yaks/wake. RAM takes `computed`; SQL storage takes `derived`.
`bug.status` comes from the resolved/archived marks. `bug.people` is distinct
actors among retained occurrences. `bug.hits` is historical and does not shrink
when occurrences are trimmed.

`report(error, context)` never throws. Context supplies `sink`, the failing
work's `actor`, commit/version, global `during` references, and optionally a
request bundle. `caught` excludes refusals. Request bodies, headers and query
strings and console argument arrays are not sent. A failed sink uses the
fallback, or console, without reporting itself recursively.

The queue sink takes a binding with `send`; the spool sink takes an append
function; the post sink takes a URL and an optional fetch implementation. The
box service takes a `source()` yielding `{rows, ack}` records. It calls `ack`
only after graph admission. The `/file` adapter appends one fsynced JSONL
segment per record and removes it only on acknowledgement. An incomplete tail
stays on disk while complete records continue. Segments use independent names,
so concurrent processes never share an append offset.

`effects({graph}, options)` accepts `code: {cwd, url, origins}` for box frame
resolution through the fleet catalog, an `enrich` function for another host, a
space `notify` stream callback, or a platform/box mail `to`, `from` and global
tracker `store` eid. New bugs and regressions share a letter per minute,
scheduled by a graph wake; bugs become notified only after its `delivered` mark.
Space replies own their own notified mark. Archived bugs still count but never
notify. Retention keeps the newest hundred plus the first occurrence of each
commit (or version without a commit).

## Browsing

The tracker writes the first error's type and value (or message) to `doc.title`.
A bug's **headline** is the first line of that title, with terminal colours left
out, an address without its query and an id or a long number cut to its start.
Wherever a bug is named (a list row, a link, a card's bar) it reads as its
headline; its page shows the whole message on a press. `bug.fault` is the
grouping key, on the bug's page behind a press. The `./views` facet exports
portable bug and error readings, and inspector views whose `asks` request the
bug's errors. The host answers those asks and draws each error through the same
registry. The count includes trimmed errors.

The box config sets `@yaks/web`’s `with.home` (`title` and `query`) to list open
bugs by descending `bug.hits` (worst first); resolved and archived bugs remain
addressable but leave that list. The box config enables human ids, so each bug
has an address such as `/B-7`. The same list is available through
`yak --config ~/.yak/tracker.json bug list`.

```ts
import { equal } from '@yaks/testing'
import { occurrences, openBugs } from '@yaks/tracker/views'

equal(openBugs, '.bug.status=open * .order=-bug.hits')
equal(occurrences('bug'), '.error.bug=bug * .order=-error.at')
```

## The box role

Copy `box.json` to `~/.yak/tracker.json` and `yak-tracker@.service` to the user
systemd unit directory. The tracker uses `~/.yak/tracker.db`, never `yak.db`.
Its command is
`yak work --config ~/.yak/tracker.json --roles
effects,@yaks/tracker`:
composition opens graph, effects and this service only, with the standard leases
and process wind-down. It imports no web routes.

Add `"tracker": {"spool": "tracker-spool"}` to the watched graph's config.
`compose()` connects tool, effect, request and duty failures to that spool
without opening the tracker graph. The reporting process stamps its startup
commit and global process eid. A tool preserves the failing call's `$actor`.
Console telemetry remains alongside reporting. Intake commits the full bundles
before acknowledging them; a crash in between resends the same eids.

After copying the template, run `systemctl --user daemon-reload` and enable
`yak-tracker@boot.service`. `yak restart` hands over the primary workers and the
active tracker workers before draining the old ones, and separately restarts
`yak.service` and the active `yak-tracker-web.service`. Both tracker workers use
the same tracker config and spool; its leased intake finishes an admitted record
before releasing the lease. The tracker web unit runs
`yak serve --no-duties --config ~/.yak/tracker.json`, independently of intake.

To move an installed `yak-tracker.service` onto the template, copy
`yak-tracker@.service` into `~/.config/systemd/user/`, run
`systemctl --user daemon-reload`, then `yak restart` while the old tracker is
still active. The replacement becomes ready before that unit drains. Once the
handover is queued, disable `yak-tracker.service` without `--now`, remove its
unit file, enable `yak-tracker@boot.service` without `--now` for the next login,
and run `systemctl --user daemon-reload` again. Do not start a second boot
worker while the ready candidate is serving the role. No mail recipient is
configured by default. The sample plugin options name the box checkout and fleet
HTTP catalog; adjust `code.cwd`, `code.url` and served `code.origins` for
another machine. No source records are copied into the tracker. Loading the mail
vocabulary alone sends nothing.

## Frames and code

`stackFrames(stack)` parses Deno/V8 and Firefox/Safari stacks in top-first
order, including causes. It bounds stacks and frames and removes URL query
strings. `error_group` commits parsed text and counts the occurrence without
contacting the code catalog. `error_frames` enriches it separately, so catalog
downtime cannot stall intake or grouping. Catalog failures retry in the effect
pool; starting the pool rechecks retained occurrences without recounting them.

The box resolver accepts paths only under its repository's Git checkout roots,
or HTTP module URLs at explicitly configured origins. It checks regular files in
`error.commit`, never mutable checkout bytes. It asks the fleet's `/query` door
for the derived file and exported-symbol eids. A module resolves only when its
catalog blob matches that commit; a symbol resolves only by its exact export
name in that module. No catalog record means no link. A known repository frame
is in-app even while its catalog is missing or outdated; dependencies are not.
Non-exported functions and anonymous arrows can resolve a module only.

`bug.culprit` is the first in-app frame with a resolved symbol. Until one
resolves, `bug.spot` keeps the top in-app frame, or the first text frame when
none is known. Later enrichment fills the culprit and removes its text fallback.
The canvas now serves `/web/app.js` as a bundle, so those frames, worker bundles
and hosted app files remain text: v1 supplies no source-map guesses.

## Transition boundaries

The browser script has moved here; the existing platform asset is a symlink and
still speaks its existing intake payload. Switching that door onto the tracker
is later work. Production Sentry remains enabled.

Tools still declares legacy exception fields until T-59080 migrates them. Its
new `type` and `value` coexist with those fields; tracker extends only `frames`
and `mechanism` for now. No legacy exception rows are cleared.

Heal temporarily projects tracker-owned `bug` declarations and reexports fault
grouping until T-59079 turns it into a tracker subscriber. Do not load that
transitional heal vocabulary in a tracker store.

## Sentry on the box

`@yaks/tracker/sentry` is the shared Sentry ingest transport for box host
failures and harness disk alerts. It accepts the existing ingest DSN, or
discovers one with the existing read token; it holds no credentials in the graph
or logs. The CLI reporter keeps its durable tracker spool and also sends caught
failures through this transport, tagged with their handler and target. It
resolves `SENTRY_DSN` or `sentry` from the host vault when used, so a credential
arriving after startup is not cached as missing. A reporting failure is retained
in the spool without recursively reporting to Sentry.

## Bounded trace admission

`./intake` exports `traceBatch` and `reserveTrace` for a host that bounds stored
trace writes. `traceBatch` accepts only complete captures of at most ten bundles
with trace, span, context and independent metric components. References to the
trace and parent spans must stay within the capture. Unknown properties,
identity metadata and write controls are refused. This deliberately does not
limit error intake or the box's portable immutable intake.

`reserveTrace` keeps pending reservations charged until their host records a
successful delivery's expiry. The
[tracker Worker](../../workers/tracker/README.md) uses this with its
platform-wide authority and durable metadata; no package creates a Worker or
decides which space owns a capture.

## Bug views

`@yaks/tracker/views` contributes bug and occurrence readings through the host's
shared renderer and inspector contracts. Open bugs are ranked by historical
hits, not retained sample size. A bug's row gives its headline, hits, where it
was thrown, and when it was last and first seen.

A bug page shows when it happened, as a histogram of the retained occurrences
from the first to now; where it ran, as the few values most occurrences share
for each commit, tag and context reference, the rest on a press, and the commit
it was first seen in; the newest occurrence's stack with the app's own frames
marked; and the retained occurrences, newest first, each by its moment, commit
and tags. An occurrence's page shows where it was thrown, its context, its stack
and the breadcrumbs before it.

An occurrence links traces with the same recorded request identity. Without that
identity, it asks for traces of the same store/process, scoped by app and space,
within five minutes of the occurrence; that context is labeled as nearby rather
than causal. Traces are drawn by the host registry: their trees, metrics,
flamegraphs and comparisons belong to
[`@yaks/timing/views`](../timing/README.md#trace-views), not this package.

For a box browser, configure this package and `@yaks/timing` beside the browser
application and use this home query:

```text
.bug.status=open * .order=-bug.hits
```

The trace list is at `/?q=.trace`. Missing affected context or missing traces
are stated; they are not inferred from a stack's text.
