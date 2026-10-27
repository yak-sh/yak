---
doc:
  title: Scheduling
guide:
  slug: wakes
  brief: scheduling with a wake row, recurrence, cron lines, and rules that run on firing
  description: >-
    Scheduling, timers and recurring jobs as data: a `wake` on any entity
    records when it is due, the app's own store wakes itself at that moment
    and stamps `fired`, and a rule the app declares decides what the firing
    does. Recurrence with durations, cron expressions and time zones; pausing
    and resuming; scheduling a command to run later; an idle game world
    advancing offline every five minutes, catching up a missed stretch in one
    firing, and pausing while nobody is playing; where a firing runs and its
    time and CPU limits; why there is no Cron Trigger, no `scheduled()` and no
    queue.
---

# Scheduling

The map is at <https://yaks.app/docs.md>. This page covers scheduling in full:
the row that records when something is due, what happens when it fires, and the
rule that decides what the firing does.

An app has no cron and no long-running worker. Instead it has a component: any
entity in its store can carry a `wake`, and the store wakes itself when that
wake is due.

## The `wake` component

    await apply({
      entity: { eid: '$fern' },
      doc: { title: 'Fern' },
      plant: { window: 'north' },
      wake: { at: '2026-09-20T09:00:00Z', note: 'water me' },
    })

That one write is the whole request. `wake` has five properties and every one is
optional except the time:

- **`at`**: when it is due, as an instant. When absent, nothing is due: a
  one-shot wake that has already fired, or a schedule someone paused.
- **`every`**: how it repeats, if it does. See below.
- **`while`**: how it repeats only while a condition holds. See
  [conditional schedules with `while`](#conditional-schedules-with-while).
- **`note`**: a line of text for whoever handles the firing, saying why the wake
  was set.
- **`target`**: another entity this wake is about, when it is not about the one
  carrying it.

Any entity may carry one: a plant, a lease, an invoice, a draft nobody has sent.
The wake goes on the entity itself, so there is no separate table of jobs to
keep in sync with your data.

## When a wake fires

At `at`, the app's own store writes two things on that row, in one transaction:

- **`fired: { at }`**: the instant it fired.
- **`wake.at`**: moved on to the next occurrence, or cleared when there is no
  next one.

So a one-shot wake fires once and leaves `wake.at` empty; a recurring wake fires
and is immediately due again at its next occurrence. `fired` is the component
that records that the wake has fired, and it is what your rules match on.

Nothing polls. The store asks the platform to wake it at the earliest time any
of its wakes is due, so an app with no schedules costs nothing and an app with
one is woken only for that one. An app with no activity for a week still fires:
the schedule is a stored row, not a timer that something has to keep running.
Occurrences missed while nothing was running are combined into one firing, which
then moves `wake.at` past the current time: a daily sweep that missed four
occurrences runs once, not four times in a row.

## Rules that act on a firing

A wake carries no action. What happens when it fires is decided by your app's
rules that match `fired`, and a rule is a `vocab.json` entry like a component,
with no code to write and nothing to deploy separately:

    { "$defs": {
        "plant":   { "properties": { "window": { "type": "string" } } },
        "watered": { "properties": { "by": { "type": "string" } } },
        "waters": {
          "rule": true,
          "description": "a plant whose wake has fired has been watered",
          "match": ".plant, .wake, .fired, +!watered, +watered.by=wake"
        } } }

The `match` is a filter with two extra operators:

- **`+comp`** writes that component (`+watered.by=wake` writes
  `watered { by: "wake" }`).
- **`+!comp`** is a gate: the rule fires only while that component is absent,
  and once the rule has written it, it is no longer absent. That is how a rule
  fires once per entity rather than on every later write to the row.

The other clauses (`.plant`, `.wake`, `.fired`) mean what they mean in any
query. The rule runs inside the firing's transaction, so the row comes out of
`apply` already carrying what the rule wrote, and a page watching that row sees
one batch, not two.

A rule can match any write, not only a firing. `.invoice, .paid, +!receipt` has
the same shape and acts on a different event.

## Recurring wakes: `every`

`every` sets how a wake repeats, in one of three forms:

    30s   2m   90m   2h   1d   3d   1w        a duration, from the last one
    0 9 * * 1-5                               five cron fields
    @hourly  @daily  @weekly  @monthly        named schedules

A duration is counted from the `at` you gave: with `every: '1d'`, a wake first
due at 09:00 stays due at 09:00. A cron expression names calendar fields:
minute, hour, day of month, month and day of week, with wildcards, ranges, steps
and lists, and Sunday as 0 or 7.

A cron expression may end with a time zone, and that is the only place a time
zone is written:

    20 4 * * * America/Detroit
    @daily Asia/Kathmandu

Without one it is UTC. Daylight saving time is handled: a time that does not
exist in spring moves forward by the gap, and a time that occurs twice in autumn
fires at the first.

Writing `every` with no `at` starts it at its first occurrence, so
`wake: { every: '@daily' }` is a schedule that begins tomorrow rather than a row
that never fires.

## Pausing, resuming and stopping

    wake: { at: null }                     paused; it keeps its every
    wake: { at: '2026-10-01T09:00:00Z' }   due again at that time
    wake: null                             removes the schedule
    entity: { …, tombstone: {} }           deletes the entity, schedule and all

A paused wake is still stored and has nothing due, which is why pausing clears a
property instead of deleting the wake. `fired` is left as it was: it records
history, not state.

An app in the trash (`app_delete`, or its whole space's `space_delete`) fires
none of its wakes. `app_restore` or `space_restore` brings them back, and each
wake that came due while the app was in the trash fires once, then continues on
its schedule.

## Scheduling a command

An app's own commands (the tool entries of its `vocab.json`) can be run by the
store itself, and a request to run one is a row like any other. A `call` names
the command and its arguments; a `wake` on the same row records when to run it:

    let [digest] = await query('.tool.name=send_digest')

    await apply({
      entity: { eid: '$monday' },
      call: { to: digest.entity.eid, args: { list: 'weekly' } },
      wake: { at: '2026-09-21T09:00:00Z', every: '@weekly' },
    })

`call.to` is a command's own _row_. A deploy writes one per declared command,
carrying `tool { name, description }`, so you look the command up by its name. A
`to` naming no command this store knows is left in place rather than refused,
since another runner may own it, so a mistyped name gives a call that never
runs.

A call with no wake runs as soon as it is written. A call with a wake waits, and
the firing runs it, so the result is written beside the request: a `result`
pointing back at the call, an `execution` recording `done` or `failed`, and
whatever the command itself wrote. Nothing is lost if the app had no activity:
the call is a stored row, and so is the time it is due.

A call with `every` is a standing request and is never run itself. Each firing
writes its own call, `call { to, args, source }`, with `source` naming the
schedule, so a weekly digest is fifty-two calls and fifty-two results a year,
never one call run again. A firing for the same instant twice produces the same
call, so a re-delivered alarm changes nothing.

A command may declare `"worker": "/tick"` instead of `apply` or `query`. A
scheduled call then invokes that route in the app's `worker.js`, even when no
page is open. The worker receives `x-yak-command-call` (this invocation's eid),
`x-yak-command-source` (the standing request's eid), and `x-yak-command-at` (the
invocation's creation time). The platform sets these headers; a visitor cannot
supply them. The worker reads and writes through its usual scoped `env.STORE` or
`env.APP` binding. Keep one step's writes in one `apply` and record the call eid
there so a retry cannot repeat it. To stop a standing request, remove its `call`
and `wake` together: removing only `wake` would make the call immediately due.

## Advancing an idle game world offline

An idle game is the most demanding case: a few minutes between ticks, and the
world has to keep advancing while nobody has the page open. It takes one row:
the world entity carries both the call and its schedule:

    let [advance] = await query('.tool.name=advance')

    await apply({
      entity: { eid: '$world' },
      world: { name: 'Eldermoor' },
      call: { to: advance.entity.eid, args: {} },
      wake: { at: new Date().toISOString(), every: '5m' },
    })

`advance` is the app's own command, declared in `vocab.json` like any other:

    "advance": {
      "tool": true,
      "description": "Advance the world to now",
      "apply": { "entity": { "eid": "$tick" }, "tick": {} } }

Every five minutes the store wakes itself, writes the call for that instant and
runs it, with no page open and no client connected.

**A missed stretch is caught up in one firing, not one per missed tick.** Half
an hour with nothing running produces _one_ `advance`, and the schedule
continues from the catch-up: 09:05, then 09:40, then 09:45. That is all catching
up involves, and it is why a five-minute world costs the same whether it was
watched all day or not at all.

The elapsed time is recorded on the rows. The schedule row carries
`fired { at }`, the instant it last fired, and each firing's own call is stamped
with when it was written, so the stretch that just passed is the gap between the
last two calls. What the world earned over that stretch is the elapsed time
multiplied by the amount earned per minute, and the tick cannot compute that: a
rule and a command both write rows, and neither can multiply. Compute it where
code runs: in the page as it draws, or in the app's own `worker.js`. That is the
other reason the catch-up is cheap: one firing, one elapsed span and one
calculation, instead of a thousand replayed minutes.

### Conditional schedules with `while`

A world nobody is playing in does not need to tick at all. `while` repeats a
wake only while a condition holds: a list of conditions in order, each a query
and the interval to use while it matches.

    await apply({
      entity: { eid: '$world' },
      world: { name: 'Mossvale' },
      call: { to: advance.entity.eid, args: {} },
      wake: { while: [
        { match: '.player.seen>=1-minute-ago', every: '30s' },
        { match: '.player.seen>=10-minutes-ago', every: '5m' },
      ] },
    })

The page writes `player: { seen }`, a `date-time` in its `vocab.json`, as
someone plays. At each firing, the first condition whose query matches any rows
sets when the next firing is due: every 30 seconds while somebody played in the
last minute, every five minutes while somebody played in the last ten. When none
matches, that firing is the last: `wake.at` is left empty and the store sets no
alarm, so a world nobody is playing in costs nothing.

A returning player's activity is a write, and after every write the store checks
each `while` to see whether one of its conditions now holds. The world above is
due its next tick 30 seconds after somebody arrives, without a page asking; the
stretch it was paused for is caught up in one firing, like any other. A write
that makes a faster condition hold brings a slower wake forward the same way.

A condition is checked at a firing and after a write, never on a timer alone:
use it for "while somebody is here", and use `at` for "once the sale opens".
When a wake also has an `every`, `while` falls back to it when no condition
holds, and the wake never stops. A condition the store cannot read is refused
when the wake is written, and `wake: null` stops a `while` schedule.

The repeating request is the `call`, not a rule. A declared rule that writes
onto the row it matched has to gate itself (`+!comp` above), and that gate makes
a rule fire once per entity, so "every five minutes" belongs in the schedule,
and a rule is for what one firing does to that row.

## Where a firing runs, and its limits

- **Inside the app's own store**, the same object a page writes through. A
  firing runs the rules and the declared commands, which write rows. The only
  way a firing calls your JavaScript is a command that declares
  `"worker": "/tick"` (see above): the platform POSTs the call's arguments to
  that route in your `worker.js`, within 5 seconds, and a worker that is missing
  or answers an error fails the call, recorded as a `failed` execution. Any
  other firing runs none of your JavaScript, and has no background `env` to use.
- **Using the app's own declarations**: the rules and the commands in its
  `vocab.json`, as the last deploy left them.
- **Within the Durable Object alarm's limits**, since a store's own clock is a
  Durable Object alarm. Cloudflare gives an alarm handler a maximum wall time of
  15 minutes, and the object 30 seconds of active CPU per invocation, raisable
  to five minutes (300,000 ms) on the Workers Paid plan
  (<https://developers.cloudflare.com/workers/platform/limits/>, read
  2026-09-19). The 50 ms an app's own worker gets per request (see
  <https://yaks.app/docs/code.md>) is a different limit, and not the one a
  firing uses.
- **At least once.** An alarm can be delivered twice; the firing is guarded on
  the wake's own `at`, so the second delivery finds the occurrence already
  handled. A scheduled call is derived from the schedule and the instant, so the
  same instant twice is the same call.

## Cron Triggers and queues are not supported

An app's worker cannot ask for a Cron Trigger and cannot ask for a queue, and
`app_deploy` refuses a `wrangler.toml` naming either. There is no `scheduled()`
to export: nothing forwards one, and a worker that has one is never called on
it. Both would be a second place where schedules are stored, which you would
then have to keep in sync with your data by hand. A wake row is in the same
store as the entity it is about: the same query reads it, the same page edits
it, and the same `store_restore` restores it. Put the schedule on the entity it
is about.
