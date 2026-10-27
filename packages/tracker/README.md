# @yaks/tracker

An **error** is a sample of a mistake, representing `error.hits` occurrences
(one when omitted); a **bug** groups errors with the same fault. Intake keeps a
reporter's UUID so a queue or spool resend is the same sample. Grouping runs
downstream and atomically links it and adds its hits to `bug.hits`. All
references may name entities in other stores.

| Export         | Owns                                                        |
| -------------- | ----------------------------------------------------------- |
| `.`            | Fault keys, grouping patches, regression and retention      |
| `./vocab`      | Tracker words, RAM computations and SQL-derived expressions |
| `./report`     | Capture, transport, `coalesce` and a page's reports         |
| `./page`       | Classic browser capture script and twenty breadcrumbs       |
| `./effects`    | `error_group`, `bug_notify`, `bug_follow`, `error_trim`     |
| `./views`      | Bug pages, list rows, error frames and the Bugs destination |
| `./tools`      | `bug_list`, `bug_show`, `bug_resolve`, `bug_archive`        |
| `./service`    | Spool record admission and acknowledgement                  |
| `./remote`     | Signed remote reads, bug marks and durable error delivery   |
| `./poll`       | A polled watch of the platform tracker's bugs, with marks   |
| `./fixtime`    | Time to fix: first seen (or regressed) to resolved          |
| `./graph`      | The precondition refusing an unexplained resolution         |
| `./resolution` | A resolution's explanation: its check and how it reads      |

```ts
import { normalize } from '@yaks/tracker'

normalize('T-42 failed at /srv/app.ts:10:3 after 300 tries')
// '# failed at # after # tries'
```

## Resolving a bug

Every resolved bug says why it stopped. Whoever resolves one writes the
explanation on its mark,
`resolved{at, by, via, broke, cause, since, fix,
recur}`: what broke and whom it
reached, in plain words (`broke`); why (`cause`); the commits that introduced it
(`since`) and fixed it (`fix`), each by its full sha; and whether it can come
back, and why (`recur`). A bug that stopped on its own has no `fix`, and its
`recur` says why it is believed to be a one-off. The `./graph` facet refuses a
bug's resolution without `cause` and `recur`, or with a commit named by anything
but a full sha, at every door. The tool asks for `broke` too:

```sh
yak bug resolve <bug> --broke '…' --cause '…' --since <sha> --fix <sha> --recur '…'
```

A bug that stopped is not resolved: the tracker never resolves one itself, and
one stays open until whoever finds its cause, or judges it a one-off, resolves
it. A fixer resolves its bug as its last step ([heal](../heal/README.md)). The
resolved letter, the bug's page, `yak bug show` and `yak admin errors` read the
same explanation (`explained` in `./resolution`). Bugs resolved before
explanations were kept have none, and say so.

## Host interface

Load `trackerDoc` with @yaks/kernel, @yaks/provenance, @yaks/tools, @yaks/api,
@yaks/doc and @yaks/mail. RAM takes `computed`; SQL storage takes `derived`.
`bug.status` comes from the resolved/archived marks. `bug.people` counts the
distinct people its retained occurrences reached, by their `user_id` tag, and
`bug.account` is `person` when any reached a person or a person's space and
`test` when only test accounts: a customer's bug reads apart from a probe's. Who
wrote an occurrence is the reporting process, never whom it reached. `bug.hits`
is historical and does not shrink when occurrences are trimmed.

`report(error, context)` never throws. Context supplies `sink`, the failing
work's `actor`, commit/version, global `during` references, and optionally a
request bundle. `caught` excludes refusals. Request bodies, headers and query
strings and console argument arrays are not sent. A failed sink uses the
fallback, or console, without reporting itself recursively.

`coalesce(sink)` is a sink wrapper with a 60-second window per app and fault,
using the same `faultKey` and explicit `error.fault` as grouping. The first
sample reaches the sink immediately with its stack and context. Repeats keep
only the latest sample and accumulate hits; the timer sends that sample once
with the repeat count and forgets the window. The next occurrence goes at once.
One minute bounds a continuous flood to two deliveries per fault per minute
while keeping first-failure notification immediate. Options accept a `window` in
milliseconds and a `clock` with `now()` and `after(ms, run)` returning a cancel
function. `flush()` ends current windows; `close()` also cancels timers and
waits for deliveries. A forced process exit can lose unflushed repeats.

```ts
import { equal } from '@yaks/testing'
import { coalesce, report, spool } from '@yaks/tracker/report'

let records: string[] = []
let sink = coalesce(spool((line) => {
  records.push(line)
}))
await report('missing row 42', { sink })
await report('missing row 99', { sink })
await report('missing row 100', { sink })
await sink.close()
equal(records.map((line) => JSON.parse(line)[0].error.hits ?? 1), [1, 2])
```

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
tracker `store` eid. `forwarded` names capture sources another tracker writes
the letters for: a bug whose kept occurrences all carry one of those
`error.tags.source` values is marked seen without a letter, so a bug the box
forwards to the platform tracker sends one letter, the box's. Each bug opening
and each regression gets its own letter immediately. `side` names the side of
the tracker web a store's bugs open on when they are not in its own graph: the
platform tracker's letters (`side: 'yaks.app'`) name a bug by global eid and
link to `/?q=.bug&side=yaks.app&bug=<eid>`, where the box's tracker web reads it
through `/tracker/bugs` and draws it with the same pages. Its identity derives
from the store, recipient, bug eid, opening or regression mark, and full
`created.at` or `regressed.at`, so a replayed effect keeps the same letter. A
letter is read alone by someone deciding whether it is urgent, so `letter.ts`
writes from the bug and its retained occurrences all the tracker holds: the
subject names where it ran (box or yaks.app, the space and app, and "test
account" when only test accounts were reached), the bug and its headline; the
body carries the whole message, where it ran (process or worker, app version,
operation), whom it reached, how often and in the last hour, the failing
request, the code, the commit, the top of the stack, the breadcrumbs before it,
every other tag, and a bug link. Reporters supply what it reads: the box tags
its `command` and host `roles`, yaks.app its `space` and `app` slugs and whose
space it is (`account`). A regression's letter answers the opening's thread, and
`bug_follow` adds one reply there when a bug is resolved or archived, and one
when a fixer takes it (`taken{at, by, via, task}`, once per opening); a bug that
opened without a letter stays quiet. The resolved reply says how long the bug
was open, whom it reached and the resolution's explanation, its commits linked
into the `repo` option's web pages (`"repo": "https://github.com/yak-sh/yak"`);
a resolution without an explanation sends nothing until one is written. Bugs
become notified only after their occasion's letter has its `delivered` mark; an
earlier occasion's delivery cannot mark a later regression notified. Space
replies own their own notified mark. Archived bugs still count but never notify.
Retention keeps the newest hundred plus the first occurrence of each commit (or
version without a commit). Grouping and retention read only what they decide by:
grouping reads its bug's counters, and an earlier occurrence only after a
resolution, to ask whether one shares its release; trimming reads each
occurrence's time and release, and none while the bug's hits are within the
newest it keeps. Reframing writes a bug's culprit or spot only where it moved.

An occurrence regresses a resolved bug when its `error.at` is later than
`resolved.at`, unless its commit (or version without a commit) was already seen
in the group: that is old code still running. One naming no release, such as a
systemd unit's failure reported from outside the unit, regresses on its time
alone. Earlier occurrences and occurrences at the resolution timestamp still
count, but retain `resolved` and `notified` without adding `regressed`.

## Browsing

The tracker writes the first error's exception type and value, or its
`error.message` when nothing was thrown, to `doc.title`. A bug's **headline** is
the first line of that title, with terminal colours left out, an address without
its query and an id or a long number cut to its start. Wherever a bug is named
(a list row, a link, a card's bar) it reads as its headline; its page shows the
whole message on a press. `bug.fault` is the grouping key, on the bug's page
behind a press. The `./views` facet exports portable bug and error readings, and
inspector views whose `asks` request the bug's errors. The host answers those
asks and draws each error through the same registry. The count includes trimmed
errors.

The box config sets `@yaks/web`’s `with.home` (`title` and `query`) to list open
bugs by descending `bug.hits` (worst first); resolved and archived bugs remain
addressable but leave that list. The box config enables human ids, so each bug
has an address such as `/B-7`. The same list is available through
`yak --config ~/.yak/tracker.json bug list`.

Notification links use the tracker's `url` option when supplied, for example
`"url": "https://bugs.example.com"` beside `to` and `store`. A box host
otherwise uses its configured web port (`http://127.0.0.1:5175` in `box.json`);
a host without a web address uses the bug's relative path. `code.url` and
`code.origins` name the separate code catalog and its served source origins, not
the tracker web.

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
`yak work --config ~/.yak/tracker.json --roles effects,@yaks/tracker,@yaks/mail`:
composition opens graph, effects, intake and outbound mail, with the standard
leases and process wind-down. It imports no web routes.

Add `"tracker": {"spool": "tracker-spool"}` to the watched graph's config.
`compose()` connects tool, effect, request and duty failures to that spool
without opening the tracker graph. The reporting process stamps its startup
commit and global process eid. A tool preserves the failing call's `$actor`.
Console telemetry remains alongside reporting. Intake commits the full bundles
before acknowledging them; a crash in between resends the same eids.

After copying the template, run `systemctl --user daemon-reload` and enable
`yak-tracker@boot.service`. `yak restart` hands over the primary workers and web
and the active tracker workers and web, each replacement ready before any old
unit is asked to stop. Both tracker workers use the same tracker config and
spool; its leased intake finishes an admitted record before releasing the lease.
The tracker web units (`yak-tracker-web@.service`) run
`yak serve --no-duties --share --ready <file> --config ~/.yak/tracker.json`,
independently of intake, and share :5175 with their replacement while it takes
over. No mail recipient is configured by default. The sample plugin options name
the box checkout and fleet HTTP catalog; adjust `code.cwd`, `code.url` and
served `code.origins` for another machine. No source records are copied into the
tracker. Loading the mail vocabulary alone sends nothing.

## Frames and code

`stackFrames(stack)` parses Deno/V8 and Firefox/Safari stacks in top-first
order, including causes. It bounds stacks and frames and removes URL query
strings. `error_group` commits parsed text and counts the occurrence without
contacting the code catalog. `error_frames` enriches it separately, so catalog
downtime cannot stall intake or grouping. A temporarily unavailable catalog
keeps the same effect pending and checks again after five seconds without
spending attempts or reporting an outage as another bug. A terminal catalog
error remains failed across restarts until explicitly retried. Editing an
occurrence's stack or commit owes fresh frame resolution without recounting it.
A notification whose destination is not configured likewise stays pending and
checks for repaired configuration after a minute.

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

The browser capture script (`./page`) is woven inline into each page an app
serves (workers/yak/page-script.ts) and into the box's web page (@yaks/web). It
reads its door off its tag's `data-yak-at` and the page's release off
`data-yak-version`, and posts each uncaught error, unhandled rejection, failed
fetch and `console.error` to `<at>api/report`, tagged with the `mechanism` that
caught it and the breadcrumbs before it. An error logged to the console goes
with its stack and its `cause` chain, as a server's reporter keeps them. A fetch
of the page's own origin that never had an answer (the server away, the person
leaving) is no break, and a caller leaving its rejection uncaught, as itself or
as another error's cause, does not make it one. `broken(body, refusal)` in
`./report` reads either door's body, the reporter's or the browser's Reporting
API's, into breaks, leaving out an answer `refusal` calls a no somebody meant
(default: a 4xx) and a fetch of the page's own origin that had no answer, which
the reporter woven into a tab opened before T-124729 still sends. The platform
admits captured failures into the tracker; the box hands them to the host's
reporter, which spools them like any other.

[@yaks/tools](../tools/README.md) declares `exception{type, value}` for what was
thrown in an answer or transcript entry. Tracker extends it with `stack`,
`frames` and `mechanism` on an error occurrence. Catch boundaries report the
original failure separately; recording a failed call's history never creates
another occurrence.

Groups made solely from imported historical occurrences inherit a lifecycle mark
only when every occurrence carries it, keeping the latest historical stamp.
Importing an unmarked occurrence clears an inherited mark. Existing reporter
groups and later actions on a group retain their own lifecycle; historical
imports count without causing a release regression.

## Box delivery

The CLI reporter writes each caught failure to the durable spool, with its
handler and target. The tracker service admits those records into the box
tracker independently of the remote forwarding loop. When `remote` is
configured, local admission atomically renames an error segment to
`.local.jsonl` and fsyncs the spool directory. That durable receipt survives
restarts and local occurrence retention without recounting. Remote delivery
reads only admitted error records and their request companions through the
Worker's signed platform intake; acknowledgement removes the segment only after
success. Delivery combines admitted records into batches of at most 100 bundles,
so a flood does not open one TLS connection per occurrence. Each loop retries on
its own clock, so even a stalled remote connection cannot delay local admission.
Sources supplied by a host must support independent replayable scans; file
sources supply `admitted` and `admit` receipts. A failed delivery leaves its
original record for retry and never adds a delivery error to the same outbox. A
failed delivery or standing pass, or one still running after a minute, admits a
sync failure directly to the local tracker. Its independent mail duty notifies
the configured recipient without using the failing remote outbox. Repeated
failures remain one notice until a pass succeeds. Immutable global eids make
interrupted and repeated delivery safe.

A **standing pass** reads remote bug marks every thirty seconds and reconciles
matching box groups by global eid or their fault and app. The Worker owns
resolved, archived, taken and regressed marks; the box retains its own
occurrences and counters. Remote-only bugs are not imported, and newer local
evidence is not closed by an older remote snapshot. A guarded patch leaves a
group changed concurrently for the next pass.

Both the standing pass and the poll below read what moved, not every bug
(`./poll`'s `since`): each sends the tag of what it last read, a Worker where
nothing moved answers 304, and one where something did names the bugs that moved
(workers/tracker's `GET /bugs?since=`), which are read again by id. A first
read, and one whose tag the Worker no longer knows what moved since, read every
bug.

The heal service opens the platform `./poll` watch on the open bugs in its work
host, and reads a closed bug by id with the watch's `get`, a page of ids to a
request, while work on the box is still open about it. Its signed reads and
marks run on a dedicated worker event loop, not alongside the host's synchronous
graph/effect work: signing, fetch, whole-body reads and attempt deadlines stay
together even when the host is CPU-bound. The worker opens no graph or duties;
closing the watch terminates only its owned worker and rejects outstanding
calls. An unexpected worker failure rejects those calls and the next poll starts
a replacement. `PollOpts.doors` still overrides the transport for an embedding
host or a test. This placement changes no remote attempt timeout or retry count.

`./remote` shares the signed transport with the read-through routes. Intake and
bug marks each carry a separate capability, so a reader's ticket cannot submit
errors or mark bugs. Box captures carry `error.tags.source=box`; the Worker
writes letters for platform bugs and leaves box bugs to the box tracker, and a
person's app failures (`source=app`) to their space's
(`forwarded: ['box',
'app']`). Reports retain their capture time across retries.
Host shutdown waits for every report's durable spool write.

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

## Reading remote bugs and traces on the box

The `./routes` facet owns read-through access to the independent
[tracker Worker](../../workers/tracker/README.md). It signs a one-minute
platform-admin ticket on the server and forwards only `/bugs`, `/traces` and
`/trace`. The box keeps no remote bundles. The timing views use the returned
bundles for both sides, label them `box` or `yaks.app`, and keep comparisons
within the selected remote scope and matching request/store context.

Set the Worker's URL and signing secret in this plugin's `with`:

```json
{
  "use": "@yaks/tracker",
  "with": {
    "remote": {
      "url": "https://your-tracker-worker.example",
      "secret": { "secret": "TRACKER_SECRET" }
    }
  }
}
```

Preserve the plugin's other options. The CLI resolves the secret from its vault
each time it is read; never put its value in a config. The secret must match the
Worker's `TRACKER_SECRET`. `./ticket` signs the ticket shared by the box and
Worker authorization.

With `@yaks/timing` composed, open `/?q=.trace`, choose `yaks.app`, and read
`platform` or supply a space's global eid in **Tracker scope**. The independent
Worker has no directory binding and cannot enumerate spaces. Each list page
contains up to 100 traces; **Older traces** follows the Worker's cursor. Opening
a trace reads every span page before drawing its flamegraph. Comparison uses the
latest hundred traces in that scope. Missing configuration, unavailable
credentials and refused reads show as errors, not empty lists. Tickets never
reach the browser, redirects are refused, and HTTP remote URLs are allowed only
on loopback for local probes.

Bug tools select the platform tracker with `--source yaks.app`; `box` is the
default. Both reads answer `{source: "box" | "yaks.app", rows: [...]}` as text
and `output.value`, including an empty `rows` array when no bugs match. Read
these rows with `valueIn(answer).rows` from `@yaks/tools/value`. Neither read
applies those rows to the box graph. Remote queries, ordering and limits run in
the Worker before selecting the returned bugs. Remote show takes a global bug
eid, since numbered ids belong to their own store. Resolve and archive accept
the same source selection, and a resolution carries its explanation to each
store it marks. A box mark reaches the configured Worker under the bug's global
eid before returning the local patch. Missing credentials, unavailable transport
or a refused remote mark refuse the command without marking the box copy.
Without a remote configuration, box marks remain local. A `yaks.app` mark
requires remote configuration and marks the Worker; the standing pass brings its
marks to a matching box group without importing remote-only bugs. Retrying a
mark is safe, including when the box copy is already marked.

```sh
yak bug list --source yaks.app --limit 20
yak bug list '.bug.status=resolved' --source yaks.app
yak bug show <global-bug-eid> --source yaks.app
yak bug resolve <global-bug-eid> --source yaks.app --broke '…' --cause '…' --fix <sha> --recur '…'
yak bug archive <box-bug-id>
```

### File spool recovery

A **record** is the immutable bundle array in a complete newline-terminated
JSONL segment. An incomplete segment remains untouched and does not block later
complete records. Intake visits complete records in filename order. A temporary
failure, such as a locked database, leaves that record retryable and does not
block later records in the pass. A graph refusal renames its segment to
`.refused`: its bytes are preserved, but automatic intake no longer offers it.
Repairing a refused record requires inspecting the refusal and its references;
renaming it back without repair repeats the refusal.

With remote delivery configured, successful local admission renames `.jsonl` to
`.local.jsonl`. This is the durable local receipt: retries do not re-admit a
record even if local retention has removed its occurrence. Remote delivery may
remove the segment only after that receipt and a successful remote response. A
remote failure keeps the receipt and does not block local intake. Immutable
occurrence ids make remote redelivery idempotent if acknowledgement fails. Each
pass reports failures after visiting the remaining records; it is not a backlog
size limit. A live stop finishes the record in hand and leaves the rest.

For a bounded recovery check, copy at most the selected complete segments into
an isolated spool and use a scratch graph and transport. Do not rename, delete,
or manually replay the live backlog to infer unattended health. Prove the live
path with a fresh reporter occurrence and read back its remote bug receipt.
