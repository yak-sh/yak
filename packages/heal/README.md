# @yaks/heal

`@yaks/heal` follows tracker bugs to file work, request fixer sessions and mark
finished bugs.

```sh
deno add jsr:@yaks/heal
```

## Stored data

- `task{}` + `doc{title, body}` + `filed{project, priority}` is the work item in
  the box graph. Its eid derives from the tracker bug's global eid. An
  `about{}` + `edge{from, to}` links the task to that bug; its body links to the
  tracker page. A platform bug's body adds that a failure in a person's app
  (`source: app`) is fixed in yaks.app only when yaks.app caused it, and its
  task is cancelled when the app's own code did, which archives the platform's
  record and leaves the owner's. The count and stack belong to the tracker
  alone.
- `fixer{bug}` sits on a requested fixer session. `bug` is the tracker bug's
  global eid, kept across stores and deletion. Legacy fixers may still name
  their box bug tasks.
- `nofix{}` sits on a project. Its tasks start no fixer; on the home project
  (config `project`), no task starts one.

`fixer.bug` is written by the host only.

The Sessions page offers an **Automatic fixers** switch when heal is configured.
It edits `nofix{}` on the configured home project, so every browser sees the
same choice and a restart keeps it. Off pauses new fixer starts and automatic
follow-up turns; existing sessions continue and manual sessions remain
available. Turning it on lets pending tracker bugs start again on the next
follower pass, under the usual cap and cooldown. Individual project mutes stay
in place. A configured `project` is needed to enable the switch. The read-only
`/heal/control` door exposes that project's eid and nothing else.

## What happens

The `@yaks/heal/service` **follower** follows the open bugs (`.bug.status=open`)
of the configured tracker graphs through a headless
[client](../client/README.md) subscription on `/ws`, and of the platform tracker
on yaks.app, when `remote` names it, through [tracker](../tracker/README.md)'s
polled `./poll` watch, so an answer costs what its open bugs cost, never every
bug ever filed. A **pass** reconciles the bugs of each followed tracker in turn:
every open bug in a periodic pass, or only the bugs whose answer moved. A bug
that left an answer was resolved or archived, and the pass reads it from that
tracker by id with its marks; a periodic pass also reads by id what the box's
open work is about (`about` edges from tasks neither completed nor cancelled),
so a bug closed while no pass heard it, before a restart say, still closes its
work. The platform's bugs reach people, so each pass takes them first, and after
a restart no other tracker's bug takes a fixer slot until the platform's first
poll settles (answered or failed, within a minute). The Worker has no page, so
their tasks link the bug's page on the first configured tracker web
(`/?q=.bug&side=yaks.app&bug=<eid>`), or with none name
`yak bug show <eid> --source yaks.app`. Its marks carry no precondition. The
tracker web role serves that query independently of intake. One process holds
the `@yaks/heal` service lease: the subscription and the serial fixer decisions
are a continuing duty, rather than work owed by a box commit to the effects
pool. Serve that role beside the box's other worker roles, for example
`yak work --roles effects,@yaks/heal`.

For a bug without a task, one apply writes the task, its `about` edge and, when
the gates allow it, the fixer request. An existing task linked by an `about`
edge is reused. A replay or another follower reads the task and its claim and
writes nothing while its fixer has work outstanding. A pass reads its bugs' work
together, so its reads do not grow with its bugs: one read finds every bug's
`about` edges, one reads their tasks, and the first decision that needs fixer
history reads it for every open bug. The home project and `nofix` are read once
a pass, and the running fixers once until the pass requests a fixer. A bug whose
work the pass writes reads its task and fixers again. The request is a
`session{operator}` with `fixer{bug}`, an `entry{session}` with `content{body}`
and `using{provider, model, effort}`, and a `claim{session}` on the task. The
provider and model are the native harness's default (`defaultUsing` from
`@yaks/harness/default`, the `using` on the harness's package row), read when
the request is written, so the graph write that changes every native session's
model changes the fixers' too; the request fails while no default is set. No
process starts inside the follower; the native harness answers the request. The
entry names the task and the fixer's last step: once the fix is live, resolve
the bug with its explanation through `cli`'s `bug resolve`, which the tracker
requires of every resolution ([tracker](../tracker/README.md#resolving-a-bug)).
Its instructions name the authoritative tracker and require a `bug show`
readback there. Both commands remove inherited `YAKS_HOST` defensively for bare
`yak`, while preserving the configured `cli` and config; an explicit `--config`
already selects its graph. Only the platform tracker uses `--source yaks.app`;
resolving the same bug in another tracker does not complete the authoritative
tracker's work.

Three gates precede the request; a gate refusing it still leaves the task filed:

- muted: `nofix` on the task's project or on the home project;
- at cap: `cap` fixers running: native transcripts in `pending`, `running` or
  `queued`, or managed fixers with no `exit` and a process or a start under five
  minutes old;
- cooling down: a fixer for the bug started within `cooldown`.

A native fixer remains active beyond five minutes without a process. A normal
`settled` turn with its tracker bug still open receives a continuation input in
the same session, with the default model and the configured effort. It reclaims
a released task in the same guarded apply. A claim held by another session is
reclaimed only with terminal evidence (`exit`, an explicit stop/end, or a
terminal transcript status); a live or unknown holder keeps its claim. The
continuation observes the cap and `nofix`, but not cooldown, which limits new
fixer starts. Stopped, failed or explicitly ended native sessions are not
resumed: an open bug receives a replacement after cooldown. A managed fixer that
exited, or whose bounded start expired without a process, receives a fresh fixer
request after cooldown rather than input to its old session. Managed history
alone never prevents a retry.

The follower retries held tasks each pass while the tracker bug is open, even
when the local task was completed without a newer regression. The continuation
or fresh request and removal of `completed` land atomically; if a gate refuses,
completion stays until a later pass can continue. For example, a settled native
fixer that completed its task but left the tracker bug open gets another turn in
the same session on the next pass. A newer tracker regression still requests a
fresh fixer rather than resuming the previous opening's session. Cancelled tasks
remain cancelled.

A cancelled task archives its bug. A completed task resolves nothing: a
resolution needs its explanation, which only the resolver can give, so its bug
stays open until someone resolves it explained. A tracker resolution completes
its task; archival cancels it. Cancelling work after completion archives its bug
while the bug is open; a resolved one is archived if it regresses. Only open
bugs file tasks or request fixers. A running fixer that holds a bug's task marks
the bug `taken{task}` in its tracker, as soon as heal starts it and again on a
replay that finds no mark for the bug's current opening, so the bug's letter
thread hears a fixer started. Terminal native sessions do not mark bugs taken.
[Tracker](../tracker/README.md) owns these marks: resolution allows a later
regression to reopen the bug; archival stops its notifications. A regression
newer than completion stays open even while a fixer gate holds the task
completed.

The follower writes each mark through the same client's `/apply` door, with
`optimistic: false` to await tracker admission. Its task and `about` edge are
the durable receipt: every pass, including the first after a restart, retries a
missing mark without a retry limit or a separate checkpoint. An existing mark
writes nothing. Preconditions on the marks and regression reject a stale answer
if the tracker changes before admission. Each configured tracker receives only
marks for bugs it answered, in its answer or by id. No tracker database is
opened.

The subscription reconnects with [sync](../sync/README.md)'s backoff and asks
for a fresh answer; while disconnected, its cached answer is not ready and files
nothing. An opening or query refusal is reported and retried. A failed box apply
rolls back and is reported; the next pass retries the bug from the current
tracker answer, without advancing a checkpoint. Shutdown closes subscriptions
and stops the pause between passes.

## Config

Task filing needs the box's task, project, doc and edge vocabulary; fixer
requests also need its session, model and process vocabulary. The follower keeps
tracker vocabulary in its separate RAM client, so the box graph needs no `bug`
component. Heal declares `fixer` and `nofix` and contributes its follower
service.

```json
{
  "use": "@yaks/heal",
  "with": {
    "trackers": ["http://127.0.0.1:5175"],
    "remote": {
      "url": "https://your-tracker-worker.example",
      "secret": { "secret": "TRACKER_SECRET" }
    },
    "effort": "high",
    "project": "P-19",
    "cap": 2,
    "cooldown": 1800000,
    "cli": "yak --config /home/me/.yak/tracker.json"
  }
}
```

`trackers` names base URLs of tracker graphs, not database files or config
paths. `remote` is the platform tracker Worker, the same `{url, secret}` as
@yaks/tracker's own `remote`, polled every 30 seconds at most. With neither, the
follower has nothing to do. `project` is an id or a name. `effort` is what each
fixer asks of the default model. `cap` defaults to 2; `cooldown` defaults to
1800000 ms; a changed tracker answer starts a pass within a second, and `every`
(default 60000 ms) re-checks the gates and task marks when nothing changed.
`cli` is the command line a fixer runs the tracker's tools with (default `yak`):
on a box whose tracker keeps a config of its own, `yak --config` naming it.
Every key is optional. With `nofix` on the home project, bugs still get tasks,
but no fixer is requested. A host running without duties runs no follower.

## Exports

The root export is `healDoc` and the pure `actionable` filter.
`@yaks/heal/vocab` exports `docs` for plugin loaders. `@yaks/heal/service`
exports `service`, `track` (a headless tracker watch), `follow` (one tracker's
pass), and `taskEid`. `service` accepts `open(url)` returning a `Tracker` (a
client `Watch` of the open bugs, with `mutate` and `get`, which reads bugs by id
whatever their marks) and an abortable `wait(ms, signal)` for hosts with their
own graph transport or clock.

`await follow(graph, options)(bugs, url, tracker.mutate)` reads the pass's work
for `bugs` and answers `(bug) => Promise<void>`, which reconciles one of them
through the same acknowledged write door.

`@yaks/fts` has a `heal()` that rebuilds a full-text index. That is a different
act.
