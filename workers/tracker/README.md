# Tracker Worker

An independent Worker consumes `yak-errors` into one Durable Object graph for
`platform` and one per space's global eid. It imports the same vocabulary,
reporter, grouping, effects and resolution as `@yaks/tracker`. It has no binding
to yak; queue intake does not depend on a directory or authentication lookup.

Each object says in the Worker's logs what an invocation's SQL read and wrote
when one costs 500 rows or more, line `tracker rows`: its entry point
(`GET /bugs`, `POST /errors`, `alarm`, `monitor`, …), its rows and its costliest
statement shapes, with no values (./bill.ts; `wrangler tail yak-tracker` shows
them live). A row bill reads as the work that ran it.

## Run and build

```sh
deno run -A workers/tracker/wrangler.ts deploy --dry-run
deno task test workers/tracker packages/effects/pool_test.ts
deno run -A workers/tracker/scratch.ts
```

The scratch harness owns one workerd runtime, closes it in `finally`, and
removes its scratch directory. It checks SQLite intake, duplicate delivery,
tenant authorization, subscription frames, heartbeat intake and the queue canary
through the runtime consumer. It sends no email and deploys nothing. The build
door uses the Wrangler @yaks/cloudflare pins, and the kernel's deploy guard from
`workers/yak/wrangler.ts`; `packages/cli/dependencies.ts` installs the workspace
with pnpm before a cold build.

## Access and RPC

`TRACKER_SECRET` is a dedicated tracker signing secret, not a session secret. An
authorized host issues a short-lived ticket using `auth.ts` `sign()` only after
checking the caller's platform administration or space membership. A ticket
names exactly one global scope and cannot cross into another store. Platform
tickets also require `admin: true`. No directory lookup runs here.

```ts ignore
import { sign } from './auth.ts'
let ticket = await sign({
  scope: spaceEid,
  person: personEid,
  exp: Date.now() / 1000 + 300,
}, trackerSecret)
let bugs = await fetch(`${trackerUrl}/bugs?scope=${spaceEid}&app=${appEid}`, {
  headers: { authorization: `Bearer ${ticket}` },
}).then((response) => response.json())
```

Mail uses `@yaks/mail`'s named transport selection. With no `MAIL_VIA`, the
Worker lends its `MAIL` binding. wrangler.toml sets `MAIL_VIA=resend`, which
selects the built-in Resend sender and requires a separate sending-only Worker
secret `RESEND_TOKEN`. `RESEND_WEBHOOK_SECRET` authenticates
`POST /mail/resend`; the verified correlation data routes each receipt into its
tracker using an intake ticket. `RESEND_API` and `MAIL_FETCH` replace the HTTP
boundary in probes. Missing Resend credentials leave queued delivery effects
waiting for configuration; they never select the binding instead. `MAIL_FROM`
and `MAIL_TO` keep their addresses, and switching a sender preserves the stored
activation time and letters' delivery outcomes. Threaded tracker letters require
the [Message-ID receipt bridge](../../packages/mail/README.md#named-transports).

Authenticated endpoints: `/bugs`, `/unseen`, `/traces`, `/trace`, `/query`,
`/vocab`, `/ws`, `/scopes`, `POST /resolve`, `/archive` and `/reopen` with
`{bug}`, `POST /retry` with `{of}`, and `POST /settle` with `{eids, reason}`.
`/ws?scope=…&ticket=…` accepts subscriptions, unsubscribe and ACK only, never
relay writes. `/query` returns graph bundles. General `/apply` is absent.
`POST /resolve`, `/archive` and `/reopen` require a separately signed
`mark: true` capability and `{bug: <global-bug-eid>}`, a resolution with its
explanation beside it. Reader and intake tickets cannot mark bugs. `POST /retry`
takes the same `mark: true` capability and `{of: <handler or run eid>}`, and
puts the failed effect runs it names back to pending with a fresh allowance
(@yaks/effects `settling`, the write `effect_retry` applies), answering
`{retried: n}`; the object arms its alarm after every write a door accepts, so
the pool works them within seconds. The box's `tracker_retry` tool sends it.
`POST /settle` takes the same capability and `{eids, reason}`, up to 100 of a
space's occurrences, and archives them for the reason as the platform's
`bug_settle` does (`Fixed by yaks.app: <cause>`), answering `{settled: n}`: for
reports of a fixed break that its occurrence's tags cannot name. Missing bugs
are refused with 404; malformed marks with 400. Platform-only `POST /errors`
accepts immutable error captures with a separately signed `ingest: true`
capability; ordinary read tickets cannot submit captures. Box reporters retain
their outbox until this intake admits their records. Retrying a capture
preserves its global eid and counts it once. `POST /app-errors` requires both
admin and intake capabilities. It accepts `{app, eids, mark}` to add `notified`
or `archived` to the app's occurrences; `remove: true` removes that mark,
allowing an incorrectly archived occurrence to reopen without changing its
report or delivery history.

`GET /scopes?scope=platform` answers an admin `{scopes: [space eid, …]}`: every
space tracker the Worker has routed to, which the platform tracker keeps. A
space's tracker joins it the first time it takes intake or answers a door, once
an isolate and behind the answer, so every bug door (`bug_list`, `admin_errors`,
the heal follower) reads each space's bugs beside the platform's.

`GET /bugs?query=<bug-query>&limit=50&app=<global-eid>` returns bug bundles,
filtered and ordered before its 1–100 limit. Without `query` it includes all bug
statuses. `GET /bugs?bug=<global-bug-eid>` returns that bug followed by its
retained occurrences, or 404 when absent. Both forms are read-only, and both
carry the store's **tag** as their `ETag`: it moves in the transaction of every
commit beyond the effect pool's and the scheduler's bookkeeping and the traces,
and is kept in the object's `server_meta`, since the object hibernates ten
seconds after its last request and wakes as a new instance. A reader that sends
the tag it holds as `If-None-Match` (compared weakly, since Cloudflare marks it
`W/` when it compresses the answer) is answered 304 while it stands, reading
only the tag's row; the box's poll and its reconciliation of standing both do,
so a tracker whose bugs have not moved costs their 30 s polls a row each.

Beside the tag the store keeps the **moves**: each entity those commits wrote,
under the count it moved the tag to, the latest thousand of them, with an
occurrence (and what came with it) counted as a move of its bug.
`GET /bugs?since=<tag>` answers which entities moved since a tag the reader
holds, `{"moved": [eid, …]}` with the current tag as its `ETag`, and the reader
reads only those again, a page of ids at a time
(`query=<bug-query> .entity.eid=<eids>`). A tag from another era, or older than
the moves reach, is answered `{"moved": null}`, and the reader reads whole. So a
change to one bug costs each reader that bug, not every bug.

`GET /ceiling` with an admin ticket reads the scope's row counters and remaining
wait without booting its graph. After repairing a runaway, `POST /resume` with
admin and `mark: true` and `{reason}` starts fresh windows at the same limits
and arms the alarm. It opens each window once: a window an earlier resume opened
stands until it ends, and the answer's `wait` says how long, so resuming again
and again spends at most two windows' rows in one (2026-11-12: 41 resumes in 41
minutes wrote 3.5 million rows in an hour, seven windows' worth). It preserves
every report and queued run, and keeps each recovery's previous counters, caller
and reason in object storage.

`POST /regroup` requires an admin ticket with `mark: true`. It repairs existing
bundle-hash fault keys in that scope, merging equivalent groups atomically. The
survivor keeps its lifecycle and notification; duplicate addresses still resolve
to it. A repeated pass makes no changes. A group changed concurrently is left
for the next pass.

`GET /traces?app=<global-eid>&limit=50&after=<trace-eid>` returns
`{rows, next?}` ordered by descending `trace.at`.
`GET /trace?eid=<trace-eid>&limit=100&after=<span-eid>` returns
`{trace, spans, next?}`; span pages are ordered by entity eid, and each span
preserves its separate metric components. Both page limits are 1–100. The `next`
eid is supplied as `after` to continue. Traces are admitted as complete trees,
not partial captures.

Trusted error queue batches carry reporter bundles with `during.space` by global
eid; a mixed-space batch never reaches a store. Error messages are acknowledged
only after graph admission. Redelivery preserves grouping receipts and bug hit
counts. A batch refused by queue validation is preserved unchanged in
`yak-errors-dead`, reported once and acknowledged. Failed preservation retries
without reporting; store outages still retry admission. Rejection reports use
the queue message's identity so redelivery cannot multiply bug hit counts. Error
intake does not share the trace allowance.

A message whose intake failed is redelivered after a wait: two seconds after its
first delivery, doubling to five minutes, up to a hundred times, then it is a
dead letter. So one refused intake costs one message, read at most a hundred
times over about eight hours, and nothing else. What the consumer could not take
or had to set aside it tells the platform's Tracker object directly, once a
batch, and never by a message on `yak-errors`: a report sent back through intake
is one more message for a refusing object to fail (2026-11-10: 685,603 in 25
minutes). When the platform's object is the one refusing, the report stays in
the Worker's log and the box's syncs report the tracker down from outside.

### Stopped past its rows

Each object refuses past its ceiling (@yaks/durable-object `bounded`,
`refuse: true`): 50 million rows read or 100,000 written in a minute, 200
million or 500,000 in an hour. A stopped object takes no statement until the
window ends (past its written rows only, it still reads), and a stop is no
failure: nothing reports it, and nothing spends an attempt on it.

- Intake and the alarm's drain each spend a share of every row window of their
  own (the ceiling's `lane`): intake pauses once its deliveries have written a
  quarter of a window, grouping once its drain has written half, and the rest is
  foreground work. One lane's backlog never spends the other's share, so a
  grouping backlog cannot hold new reports, a deploy's canary among them, on the
  queue until the window ends. A paused delivery preserves grouping's earlier
  alarm.
- Intake that meets a stop is put back on `yak-errors` as a new message, delayed
  until the window ends (queue.ts `consume`, `later`), and the message is
  acknowledged. So a stop spends none of a message's hundred deliveries, never
  lengthens its next failure's wait, and never makes it a dead letter. The rest
  of a batch for that object waits as long without asking it. A message the
  queue can't take back is retried after the same wait.
- A report the consumer tells the platform's object (above) that meets a stop is
  put on `yak-errors` delayed until the window ends, one message, and is taken
  then. The object's own runaway report travels the queue the same way.
- A fixer's mark on a known bug (`/resolve`, `/archive`, `/take`, `/reopen`) is
  taken while stopped: it runs in the ceiling's `free`, told and never refused,
  so a flood that stops the tracker never holds back the fix that answers it
  (2026-11-12: the hour's 500,000 rows written stopped every resolution for 18
  minutes).
- Any other door answers 429 with `retry-after` and
  `{error: 'Stopped', message,
  retry}`; a box reporter's outbox keeps its
  captures until intake admits them.
- The alarm does nothing while stopped but come back when the window ends; a
  failed intake arms it for then, not a second out. An effect that meets a stop
  runs again as the same attempt (@yaks/effects).
- A trace capture the platform's object can't reserve for is dropped, as any
  over-ceiling capture is.

A stop crosses from the object to the Worker as a new error carrying its name,
message, `status` and `retry` (enhanced error serialization, on from
compatibility date 2026-04-21), never its class, so the Worker knows it by those
(@yaks/durable-object `stopped`).

Stopped, an object costs at most about $0.20 of reads and $0.50 of writes an
hour, plus the statement that stopped it: at the 2.4 million rows a CPU-second a
Store's scan ran (T-154469), about 72 million rows, $0.07, before the default 30
s CPU limit ends it. A message set back on the queue costs three queue
operations each time (about $1.20 a million), once a stop.

A failure in an app whose space is not a probe's is recorded twice: in the
space's store for its owner, and in the platform's as its own occurrence, with
no space or app in `during` and `error.tags.source=app`, so `yak admin errors`
and heal see it. The platform groups it by fault and marks it alone; the space's
tracker writes its letter (`forwarded: ['box', 'app']`).

### Trace write ceiling

The platform tracker object serializes admission for every space and reserves a
conservative write bound before forwarding a trace. At most 42,000 reserved rows
can overlap any rolling hour. A reservation is 64 rows per bundle plus eight
rows for the two durable metadata writes, plus 512 rows for setup (256 for the
platform tracker and 256 for the destination tracker). This setup bound is
reserved on every capture, including warm trackers and redelivery; platform
captures reserve both bounds even though they use one tracker. Accepted captures
contain one trace root and its complete span tree, at most 201 bundles (one
trace and 200 spans), with only the trace/context/metric components the bounded
intake supports. The source keeps the most expensive spans and their ancestors
within 200 spans; omitted work remains in its retained parent's inclusive
metrics. Oversized, incomplete, malformed and over-ceiling captures are dropped
and acknowledged; no partial tree is stored and drops do not report new tracker
errors.

Successful reservations expire one hour after delivery completes, not at a
calendar-hour rollover. Reservations persist in the platform's existing
`server_meta`. A failed or interrupted delivery leaves its reservation pending
indefinitely: failure cannot refund writes that might already have happened.
Redelivery consumes another reservation even if immutable intake writes nothing.

`GET /trace-budget?scope=platform` with a platform-admin ticket returns the
ceiling, current reserved bound, whether any reservation is pending, and dropped
admission attempts. Drop counters are memory-only and reset when the platform
object is evicted; the spent allowance does not. Tracing does not arm alarms or
send error reports. Direct error `ingest` rejects traces so it cannot bypass the
authority.

The first admitted trace installs an empty tracker without an ordinary read. The
platform authority creates its metadata table and pending reservation in one
transaction before installing its own schema or forwarding a trace. Setup
installs only into empty storage (or the authority's metadata-only storage),
never fits standing data or backfills it. A failed setup or delivery keeps the
reservation pending. Marked trackers reopen without installation writes after
eviction. Trace setup does not initialize notification mail, arm alarms or
report errors; ordinary tracker work handles notifications independently.

Platform-only `POST /heartbeat` renews the box heartbeat. Each minute the cron
probes the home page, the MCP endpoint, an app's `api/me`, which reads the
directory on every request, so a stalled directory fails it, and that app's
`api/query?.recipe&.limit=1`, which reads its store (`PROBES` in monitor.ts). A
door that answers any status but the one it serves with (a 4xx included), or
sends nothing within 10 s, files a fatal occurrence on that door's own bug
(`tracker|platform-uptime|MCP`, `…|app`, `…|query`), and an activated box
heartbeat older than five minutes files one on `tracker|box-heartbeat`. A door
that answers again resolves nothing: the bug stays open until an agent finds why
it failed and fixes it, and its last occurrence says when it stopped. Each
tracker graph sends one letter per new bug opening through its own `MAIL`
binding, with `MAIL_FROM` and `MAIL_TO` configured at activation. Space bugs
stream through their store's graph subscription and remain unseen until their
caller marks notification in the platform integration.

## Activation and deployment

Account setup supplies `yak-errors`, `yak-errors-dead`, a Workers Builds
connection for this Worker, its own Email Sending binding, and the dedicated
`TRACKER_SECRET`, `MAIL_FROM`, `MAIL_TO` Worker secrets. The build needs no
tracker secret; configure its nonsecret `TRACKER_URL` with the Worker URL. The
build may deploy only this Worker. Source is ready; production queue and build
activation are separate account operations.

The first ordinary wake with all mail settings persists the activation time and
refreshes the recipient in an already installed platform tracker. Earlier bug
openings stay unseen and produce no letter; later openings and regressions each
own one durable letter. Trace intake does not activate mail. A deployment's
canary is a probe (`probe{grouped}` in
[@yaks/tracker](../../packages/tracker/README.md#probes)): no bug, so no letter
and nothing for a fixer.

Workers Builds: repository root, deploy command `sh bin/build-tracker`, with
build command empty. The wrapper installs Deno and the pinned npm dependencies.
Watch `workers/tracker`, `packages` and `bin/build-tracker`.

Intake preserves an already scheduled earlier alarm. Repeated queue deliveries
must not move grouping's return later; otherwise continuous intake can admit
captures while indefinitely postponing the effects that group them.

`deploy.ts` hashes the dry-run bundle with wrangler.toml and skips an unchanged
deployment, so a changed var deploys like changed code. Builds run one per push
and finish in any order, so, like the yak Worker's deploy door (`superseded` in
[workers/yak/wrangler.ts](../yak/wrangler.ts)), a build deploys only while
main's tip has no newer tracker source (the watched paths above) and no live
version comes from a newer commit; each version's message names its commit and
bundle. It sets the nonsecret `BUNDLE_HASH` binding and publishes a content-hash
canary through the Worker's queue. It republishes the same capture every thirty
seconds until intake and grouping write its receipt, allowing Worker and object
versions to converge. A canary the tracker says failed, or one still missing
after ten minutes, is reported to the tracker and fails the build. Nothing rolls
back: the new version stays live, and an agent decides whether to roll back or
fix forward. A build whose canary waited while a newer commit's build deployed
reports nothing: that build answers for itself, even with the same bundle. No
legacy error store is deleted, and yak reporting/read-path changes are outside
this Worker.

`POST /canary?scope=platform&hash=<bundle-hash>&nonce=<uuid>&at=<iso-time>`
needs no ticket and returns `{eid}` for a probe: one synthetic occurrence that
travels the queue, intake and the grouping run as a failure does, where grouping
writes its receipt (`probe.grouped`) and files it under no bug. Only the
deployed `BUNDLE_HASH` is accepted. The timestamp must be canonical ISO UTC, at
most fifteen minutes old or one minute ahead. The server derives the
content-hash eid from the bundle hash and nonce; retrying them with the same
timestamp preserves the entire capture. The request body is ignored. A Durable
Object moves to a new version seconds to minutes after the Worker, and one on
the release before would prove nothing of this bundle, so the probe is sent only
once the platform Tracker object reports the same `BUNDLE_HASH` (its admin-only
`GET /bundle`); until then a publication answers its `{eid}` and sends nothing.
`GET` on the same URL with `&eid=<receipt>` returns only
`{arrived: boolean, failed?: true}`. It is true once that exact probe has its
receipt in an object running this bundle. Grouping is the object's alarm-driven
effect queue, so the answer reads the probe and its grouping run from the graph
rather than waiting for them. A grouping run left failed is `failed`; pending
work, including a retry or a wait behind a backlog, stays pending until the
deploy's ten-minute deadline reports it missing. A probe moves no bug, so a
reader polling the bugs is told nothing moved, and each probe's grouping deletes
the probes grouped over an hour before.

`POST /canary/missing?scope=platform&hash=<bundle-hash>&nonce=<uuid>` needs no
ticket. Unless that canary arrived (409), it reports the deploy unconfirmed,
with why as the Worker reads it, on a `tracker-deploy|<hash>` bug, which
notifies like any other. One nonce is one occurrence however often it is sent.
Graph reads and other tracker operations require scope tickets.
