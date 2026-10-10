# @yaks/heal

`@yaks/heal` reports actionable exceptions through the host's reporter and
follows tracker bugs to file work, request fixer sessions and mark finished
bugs.

```sh
deno add jsr:@yaks/heal
```

An `exception` (@yaks/tools) on any entity is the trigger. `refusal` is a
deliberate no and never reports anything. Legacy `error` outcomes also never
report anything.

## Stored data

- `task{}` + `doc{title, body}` + `filed{project, priority}` is the work item in
  the box graph. Its eid derives from the tracker bug's global eid. An
  `about{}` + `edge{from, to}` links the task to that bug; its body links to the
  tracker page. The count and stack belong to the tracker alone.
- `fixer{bug}` sits on a requested fixer session. `bug` is the tracker bug's
  global eid, kept across stores and deletion. Legacy fixers may still name
  their box bug tasks.
- `nofix{}` sits on a project. Its tasks start no fixer; on the home project
  (config `project`), no task starts one.

`fixer.bug` is written by the host only.

## What happens

The `@yaks/heal/effects` handlers report exceptions after each commit.
`created(exception)` reads `exception.value`, `exception.message`, or
`content.body`, skipping known transients (timeouts, reset connections and
provider 5xx responses). `exception_report` calls `host.report` with the
original exception type and stack. Context names the exception entity and its
kind, its session or process when present, and its caught time and build
version. The occurrence id derives from the exception entity's eid, so effect
redelivery reaches tracker intake as the same occurrence.

The [box host](../cli/README.md) supplies the reporter, which fans out to Sentry
and the tracker spool through `@yaks/tracker/report`'s `coalesce`. Heal opens no
tracker database or spool and writes no task when an exception arrives.

The `@yaks/heal/service` **follower** follows bugs in the configured tracker
graphs through a headless [client](../client/README.md) subscription on `/ws`.
The tracker web role serves that query independently of intake. One process
holds the `@yaks/heal` service lease: the subscription and the serial fixer
decisions are a continuing duty, rather than work owed by a box commit to the
effects pool. Serve that role beside the box's other worker roles, for example
`yak work --roles effects,@yaks/heal`.

For a bug without a task, one apply writes the task, its `about` edge and, when
the gates allow it, the fixer request. An existing task linked by an `about`
edge is reused. A replay or another follower reads the task and its claim and
writes nothing. The request is a `session{operator}` with `fixer{bug}`, an
`entry{session}` with `content{body}` and `using{provider, model, effort}`, and
a `claim{session}` on the task. No process starts inside the follower;
[spawn](../spawn/README.md) handles that request.

Four gates precede the request; a gate refusing it still leaves the task filed:

- off: no `provider` configured;
- muted: `nofix` on the task's project or on the home project;
- at cap: `cap` fixers running: no `exit` yet, and a process or a start under
  five minutes old;
- cooling down: a fixer for the bug started within `cooldown`.

The follower retries held tasks each pass. A completed task is reconsidered when
the tracker reopens its bug with a `regressed{at, error}` mark newer than that
completion. The new fixer request and removal of `completed` land atomically. If
a gate refuses the request, completion stays until a later pass can start the
fixer. Ordinary occurrences and old regression marks do not reopen completed
work. Cancelled tasks remain cancelled.

A completed task resolves its bug; a cancelled task archives it. The follower
keeps resolved bugs in its answer and leaves archived bugs out, so cancelling
work after completion still archives its bug. Only open bugs file tasks or
request fixers. [Tracker](../tracker/README.md) owns these marks: resolution
allows a later regression to reopen the bug; archival stops its notifications. A
regression newer than completion stays open even while a fixer gate holds the
task completed.

The follower writes each mark through the same client's `/apply` door, with
`optimistic: false` to await tracker admission. Its task and `about` edge are
the durable receipt: every pass, including the first after a restart, retries a
missing mark without a retry limit or a separate checkpoint. An existing mark
writes nothing. Preconditions on the marks and regression reject a stale answer
if the tracker changes before admission. Each configured tracker receives only
marks for bugs in its own answer. No tracker database is opened.

The subscription reconnects with [sync](../sync/README.md)'s backoff and asks
for a fresh answer; while disconnected, its cached answer is not ready and files
nothing. An opening or query refusal is reported and retried. A failed box apply
rolls back and is reported; the next pass retries the bug from the current
tracker answer, without advancing a checkpoint. Shutdown closes subscriptions
and stops the pause between passes.

The legacy `bug_fix` effect and its boot sweep still handle box bug tasks when
that graph declares tracker `bug` vocabulary. They share the follower's gates
and fixer request; they never give a legacy bug task a second fixer.

## Config

Exception reporting needs the host's `report` capability and `@yaks/tools`'
exception vocabulary. Task filing needs the box's task, project, doc and edge
vocabulary; fixer requests also need its session, model and process vocabulary.
The follower keeps tracker vocabulary in its separate RAM client, so the box
graph needs no `bug` component. Heal declares `fixer` and `nofix` and
contributes the exception and legacy bug effects plus its follower service.

```json
{
  "use": "@yaks/heal",
  "with": {
    "trackers": ["http://127.0.0.1:5175"],
    "provider": "codex",
    "model": "gpt-5.6-sol",
    "effort": "high",
    "project": "P-19",
    "cap": 2,
    "cooldown": 1800000
  }
}
```

`trackers` names base URLs of tracker graphs, not database files or config
paths. With none, the follower has nothing to do. `provider`, `model` and
`project` are ids or names. `cap` defaults to 2; `cooldown` defaults to 1800000
ms; a changed tracker answer starts a pass within a second, and `every` (default
60000 ms) re-checks the gates and task marks when nothing changed. Every key is
optional. Without `provider`, bugs still get tasks and exceptions are reported,
but no fixer is requested. A host running without duties runs no follower.

## Exports

The root export is `healDoc` and the pure `actionable` filter.
`@yaks/heal/vocab` exports `docs` for plugin loaders, and `@yaks/heal/effects`
exports `effects`. `@yaks/heal/service` exports `service`, `track` (a headless
tracker watch), `follow` (one bug's reconciliation), and `taskEid`. `service`
accepts `open(url)` returning a `Tracker` (a client `Watch` with `mutate`) and
an abortable `wait(ms, signal)` for hosts with their own graph transport or
clock.

`follow(graph, options)(bug, url, tracker.mutate)` reconciles one bug through
the same acknowledged write door.

`@yaks/fts` has a `heal()` that rebuilds a full-text index. That is a different
act.
