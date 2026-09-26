---
name: wakes
description: "Coming back later (yaks.app). Schedules as data: a `wake` on any entity records when to return to it, the app's own store wakes itself at that moment and stamps `fired`, and a rule the app declares decides what the firing means. Recurrence in durations, cron lines and zones; pausing and resuming; a command asked for later; an idle world advancing offline on a five-minute cadence and catching a missed stretch up in one firing, and one that sleeps while nobody is in it; where a firing runs and what it may spend; why there is no cron trigger, no `scheduled()` and no queue to ask for."
---

# Coming back later

The map is at <https://yaks.app/docs.md>. This page is the whole of scheduling:
the row that records when, the moment it goes off, and the rule that decides
what it means.

An app has no cron and no worker sitting awake. What it has is a component:
anything in its store can carry a `wake`, and the store comes back for it.

## A wake is a row

    await apply({
      entity: { eid: '$fern' },
      doc: { title: 'Fern' },
      plant: { window: 'north' },
      wake: { at: '2026-09-20T09:00:00Z', note: 'water me' },
    })

That is the whole request. `wake` has five properties and every one is optional
except the moment:

- **`at`** — when to come back, as an instant. Absent means nothing is owed: a
  spent one-shot, or a schedule someone paused.
- **`every`** — how it repeats, when it does. See below.
- **`while`** — how it repeats only while something holds. See
  [a world that sleeps](#a-world-that-sleeps-when-nobody-is-there).
- **`note`** — a line for whoever is woken: why you asked to be.
- **`target`** — another entity this wake is about, when it is not about the one
  carrying it.

Any entity may carry one. A plant, a lease, an invoice, a draft nobody has sent
— the wake goes on the thing itself, so there is no separate table of jobs to
keep in step with your data.

## The moment it goes off

At `at`, the app's own store writes two things on that row, in one transaction:

- **`fired: { at }`** — the instant it went off.
- **`wake.at`** — moved on to the next occurrence, or cleared when there is no
  next one.

So a one-shot fires once and leaves `wake.at` empty; a recurring wake fires and
is already owed again. `fired` is the component that records "this has gone
off", and it is what your rules watch.

Nothing polls. The store asks the platform to wake IT at the earliest instant it
owes, so an app with no schedules costs nothing and an app with one is woken for
that one. An app that was quiet for a week still fires: the schedule is a row,
not a timer somebody has to have been holding. Occurrences missed while nothing
was running collapse into one firing, which then moves past now — a daily sweep
that was owed four times is swept once, not four times in a row.

## What a firing means is a rule

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

The `match` is a filter with two extra marks:

- **`+comp`** writes that component (`+watered.by=wake` writes
  `watered { by: "wake" }`).
- **`+!comp`** is a gate: the rule only fires while that component is absent,
  and after it writes, it is not. That is how a rule fires once per thing rather
  than on every later write to the row.

Everything else — `.plant`, `.wake`, `.fired` — reads the way it reads in any
query. The rule runs inside the transaction the firing is part of, so the row
comes back out of `apply` already carrying what the rule wrote, and a page
watching that row sees one change and not two.

A rule can watch anything, not only a firing. `.invoice, .paid, +!receipt` is
the same shape about a different moment.

## Repeating

`every` sets how, in three forms:

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
why pausing is a property and not a delete. `fired` stays where it was: it is
history, not state.

## A command, later

An app's own commands (the tool entries of its `vocab.json`) are things the
store can run itself, and asking for one is a row like everything else. A `call`
names the command and its arguments; a `wake` on that same row records when:

    let [digest] = await query('.tool.name=send_digest')

    await apply({
      entity: { eid: '$monday' },
      call: { to: digest.entity.eid, args: '{"list":"weekly"}' },
      wake: { at: '2026-09-21T09:00:00Z', every: '@weekly' },
    })

`call.to` is a command's own _row_. A deploy plants one per declared command,
carrying `tool { name, description }`, so the name is what you look it up by —
and a `to` naming no command this store knows is left where it is rather than
refused, since another runner may own it. A mistyped name is a call that never
runs.

A call with no wake runs the moment it is written. One with a wake waits, and
the firing is what runs it — so the result lands beside the request: a `result`
pointing back at the call, an `execution` recording `done` or `failed`, and
whatever the command itself wrote. Nothing is lost if the app was quiet: the
call is a row, and so is the moment it is owed.

A call with `every` is a standing request and is never run itself. Each firing
writes its own call — `call { to, args, source }`, the `source` naming the
schedule — so a weekly digest is fifty-two calls and fifty-two answers, never
one result re-run. The same instant twice is the same call, so a re-delivered
alarm changes nothing.

## A world that keeps going

An idle game is the hardest version of this: a few minutes between ticks, and
the world has to go on while nobody has the page open. It is one row — the world
carries the request and the cadence together:

    let [advance] = await query('.tool.name=advance')

    await apply({
      entity: { eid: '$world' },
      world: { name: 'Eldermoor' },
      call: { to: advance.entity.eid, args: '{}' },
      wake: { at: new Date().toISOString(), every: '5m' },
    })

`advance` is the app's own command, declared in `vocab.json` like any other:

    "advance": {
      "tool": true,
      "description": "Advance the world to now",
      "apply": { "entity": { "eid": "$tick" }, "tick": {} } }

Every five minutes the store wakes itself, writes the call for that instant and
runs it — with nothing open and nothing connected.

**A stretch nobody was there for is one firing, not one per minute.** Half an
hour when nothing was awake to notice leaves _one_ `advance`, and the cadence
carries on from where the catch-up left it: 09:05, then 09:40, then 09:45. That
is the whole of catching up, and it is why a five-minute world costs the same
whether it was watched all day or not at all.

How long it has been is on the rows. The schedule row carries `fired { at }` —
the instant it last went off — and each firing's own call is stamped with when
it was written, so the stretch that just passed is the gap between the last two.
What the world earned over that stretch is the span times whatever a minute is
worth, and that arithmetic is not the tick's: a rule and a command both write
rows, and neither multiplies. Fold the span where code runs — the page as it
draws, or the app's own `worker.js`. Which is the other reason the catch-up is
cheap: one firing, one span, one fold, instead of a thousand replayed minutes.

### A world that sleeps when nobody is there

A world nobody is in need not tick at all. `while` repeats a wake only while
something holds: conditions in order, each a query and the cadence it asks for.

    await apply({
      entity: { eid: '$world' },
      world: { name: 'Mossvale' },
      call: { to: advance.entity.eid, args: '{}' },
      wake: { while: [
        { match: '.player.seen>=1-minute-ago', every: '30s' },
        { match: '.player.seen>=10-minutes-ago', every: '5m' },
      ] },
    })

The page writes `player: { seen }`, a `date-time` in its `vocab.json`, as
someone plays. At each firing the first condition whose query finds anything
says when the next is owed: every half minute while somebody played in the last
minute, every five while somebody was here in the last ten. When none does, that
firing is the last: `wake.at` is left empty and the store sets no alarm, so a
world nobody is in costs nothing.

Coming back is a write, and after every write the store asks each `while`
whether one of its conditions now holds. The world above is owed its next tick
half a minute after somebody arrives, with no page asking; the stretch it slept
through is one firing, like any other. A write that makes a faster condition
hold brings a slower wake forward the same way.

A condition is checked at a firing and after a write, never by the clock alone:
it is for "while somebody is here", and "once the sale opens" is an `at`. Beside
an `every`, `while` falls back to it when nothing holds, and the wake never
sleeps. A condition the store cannot read is refused when the wake is written,
and `wake: null` stops one.

The repeating request is the `call`, not a rule. A declared rule that writes
onto the row it matched has to gate itself (`+!comp` above), and a gate is what
makes a rule fire once per thing — so "every five minutes" belongs to the
schedule, and a rule is for what one firing means about that row.

## Where a firing runs

- **Inside the app's own store**, the same object a page writes through — not a
  request to your `worker.js`, which runs only when something asks it for a
  page. Nothing of the app's own JavaScript runs on a firing: what a tick can do
  is what a rule and a declared command can do, which is write rows. There is no
  background `env` to reach from it, and so no secret it could carry.
- **On the app's own declarations.** The rules and the commands in its
  `vocab.json`, as the last deploy left them.
- **Under the Durable Object alarm's budget**, which is what a store object's
  own clock is. Cloudflare gives an alarm handler a maximum wall time of 15
  minutes, and the object 30 seconds of active CPU per invocation, raisable to
  five minutes (300,000 ms) on the Workers Paid plan
  (<https://developers.cloudflare.com/workers/platform/limits/>, read
  2026-09-19). The 50 ms an app's own worker gets per request (see
  <https://yaks.app/docs/code.md>) is a different budget, and not the one a
  firing spends.
- **At least once.** An alarm can be delivered twice; the firing is guarded on
  the wake's own `at`, so the second delivery finds the occurrence taken. A
  scheduled call is derived from the schedule and the instant, so the same
  instant twice is the same call.

## Why there is no cron trigger

An app's worker cannot ask for a Cron Trigger and cannot ask for a queue, and
`app_deploy` refuses a `wrangler.toml` naming either. There is no `scheduled()`
to export: nothing forwards one, and a worker that has one is never called on
it. Both would be a second place where "later" lives, and you would then have to
keep it in step with your data by hand. A wake row is in the same store as the
thing it is about, readable by the same query, editable by the same page,
restored by the same `store_restore`. Ask for later where the thing lives.
