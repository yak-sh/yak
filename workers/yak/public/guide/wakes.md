---
doc:
  title: Coming back later
guide:
  slug: wakes
  brief: a row that says when to come back, and what happens when it does
  description: >-
    Schedules as data: a `wake` on any entity says when to return to it, the
    app's own store wakes itself at that moment and stamps `fired`, and a
    rule the app declares says what the firing MEANS. Recurrence in
    durations, cron lines and zones; pausing and resuming; why there is no
    cron trigger and no queue to ask for.
---

# Coming back later

The map is at <https://yaks.app/guide.md>. This page is the whole of scheduling:
the row that says when, the moment it goes off, and the rule that says what that
means.

An app has no cron and no worker sitting awake. What it has is a component:
anything in its store can wear a `wake`, and the store comes back for it.

## A wake is a row

    await apply({
      entity: { eid: '$fern' },
      doc: { title: 'Fern' },
      plant: { window: 'north' },
      wake: { at: '2026-09-20T09:00:00Z', note: 'water me' },
    })

That is the whole of asking. `wake` has four columns and every one is optional
except the moment:

- **`at`** — when to come back, as an instant. Absent means nothing is owed: a
  spent one-shot, or a schedule someone paused.
- **`every`** — how it repeats, when it does. See below.
- **`note`** — a line for whoever is woken: why you asked to be.
- **`target`** — another entity this wake is ABOUT, when it is not about the one
  carrying it.

Any entity may wear one. A plant, a lease, an invoice, a draft nobody has sent —
the wake goes on the thing itself, so there is no separate table of jobs to keep
in step with your data.

## The moment it goes off

At `at`, the app's own store writes two things on that row, in one transaction:

- **`fired: { at }`** — the instant it went off.
- **`wake.at`** — moved on to the next occurrence, or cleared when there is no
  next one.

So a one-shot fires once and leaves `wake.at` empty; a recurring wake fires and
is already owed again. `fired` is the row's word for "this has gone off", and it
is what your rules watch.

Nothing polls. The store asks the platform to wake IT at the earliest instant it
owes, so an app with no schedules costs nothing and an app with one is woken for
that one. An app that was quiet for a week still fires: the schedule is a row,
not a timer somebody has to have been holding. Occurrences missed while nothing
was running collapse into one firing, which then moves past now — a daily sweep
that was owed four times is swept once, not four times in a row.

## What the firing MEANS is a rule

A wake carries no action. What happens when it goes off is whatever your app's
rules say about `fired`, and a rule is a `vocab.json` entry like a component —
no code, nowhere to deploy it:

    { "$defs": {
        "plant":   { "properties": { "window": { "type": "string" } } },
        "watered": { "properties": { "by": { "type": "string" } } },
        "waters": {
          "rule": true,
          "description": "a plant whose wake has fired has been watered",
          "match": ".plant, .wake, .fired, +!watered, +watered.by=wake"
        } } }

The `match` is a filter line with two extra marks:

- **`+comp`** writes that component (`+watered.by=wake` writes
  `watered { by: "wake" }`).
- **`+!comp`** is a GATE: the rule only fires while that component is absent,
  and after it writes, it is not. That is how a rule fires once per thing rather
  than on every later write to the row.

Everything else — `.plant`, `.wake`, `.fired` — reads the way it reads in any
query. The rule runs inside the transaction the firing is part of, so the row
comes back out of `apply` already wearing what the rule wrote, and a page
watching that row sees one change and not two.

A rule can watch anything, not only a firing. `.invoice, .paid, +!receipt` is
the same shape about a different moment.

## Repeating

`every` says how, in three spellings:

    30s   2m   90m   2h   1d   3d   1w        a duration, from the last one
    0 9 * * 1-5                               five cron fields
    @hourly  @daily  @weekly  @monthly        the named ones

A duration keeps its own cadence: `every: '1d'` counted from the `at` you gave,
so a wake first owed at 09:00 stays a 09:00 wake. A cron line names calendar
positions — minute, hour, day of month, month, day of week, with wildcards,
ranges, steps and lists, Sunday as 0 or 7.

A cron line may end with a zone, and that is the only place a zone is written:

    20 4 * * * America/Detroit
    @daily Asia/Kathmandu

Without one it is UTC. Daylight saving is honoured: a time that does not exist
in spring moves forward by the gap, and one that happens twice in autumn fires
at the first.

Writing `every` with no `at` starts it at its first occurrence, so
`wake: { every: '@daily' }` is a schedule that begins tomorrow rather than a row
that never fires.

## Pausing, resuming, stopping

    wake: { at: null }                     paused, and it keeps its every
    wake: { at: '2026-10-01T09:00:00Z' }   owed again at that moment
    wake: null                             the schedule is gone
    entity: { …, tombstone: {} }           so is everything else about it

A paused wake is a row that is still there and simply owes nothing — which is
why pausing is a column and not a delete. `fired` stays where it was: it is
history, not state.

## A command, later

An app's own commands (the `tools.json` at its root) are things the store can
run itself, and asking is a row like everything else. A `call` names the command
and its arguments; a `wake` on that same row says when:

    await apply({
      entity: { eid: '$monday' },
      call: { to: 'tool:send_digest', args: '{"list":"weekly"}' },
      wake: { at: '2026-09-21T09:00:00Z', every: '@weekly' },
    })

A call with no wake runs the moment it is written. One wearing a wake waits, and
the firing is what runs it — so the answer lands beside the ask: a `result`
pointing back at the call, an `execution` saying `done` or `failed`, and
whatever the command itself wrote. Nothing is lost if the app was quiet: the
call is a row, and so is the moment it is owed.

A call wearing `every` is a STANDING ask and is never answered itself. Each
firing writes its own call — `call { to, args, source }`, the `source` naming
the schedule — so a weekly digest is fifty-two calls and fifty-two answers,
never one result re-run. The same instant twice is the same call, so a
re-delivered alarm changes nothing.

## Why there is no cron trigger

An app's worker cannot ask for a Cron Trigger and cannot ask for a queue, and
`app_deploy` refuses a `wrangler.toml` naming either. Both would be a second
place where "later" lives, and you would then have to keep it in step with your
data by hand. A wake row is in the same store as the thing it is about, readable
by the same query, editable by the same page, restored by the same
`store_restore`. Ask for later where the thing lives.
