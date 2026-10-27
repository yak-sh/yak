---
doc:
  title: Errors and Rollback
guide:
  slug: errors
  brief: error codes, error reports, rollback and the trash
  description: >-
    The error codes an ./api/ endpoint refuses with and how a page shows them,
    the error reporter in every page and POST ./api/report, where an error is
    filed and how the agent is told about it once, app_errors, app_versions
    and app_rollback, the 30-day trash (app_delete, space_delete, app_restore,
    space_restore), store_restore and file history, and feedback for anything
    you or the person have to say about the platform itself.
---

# Errors and Rollback

No error is silently dropped. This page covers what a refused call returns and
how a page shows it, what the error reporter in every page catches on its own,
where an error is filed and how you are told about it once, `app_errors`,
`app_versions` and `app_rollback`, and `feedback` for anything either of you has
to say about the platform itself.

## Refusals and error codes

Every endpoint under `./api/` refuses in the same shape: a `code` for the
program and a `message` for the person:

    {"error": {"code": "not_a_writer", "message": "sign in to change this app"}}

When signing in would allow the request, it carries a third field, `signIn`: the
platform's login page, with this page already set as its return address.

The codes an endpoint returns, and what each means:

- **`not_a_writer`** — 401 signed out, with `signIn`; 403 signed in. The app's
  `access` does not accept a write from this person. Signed out, send them to
  `signIn`. Signed in, only the owner can grant write access, and the message
  says so.
- **`not_a_reader`** — 401 signed out, with `signIn`; 403 signed in. A `private`
  app answering someone who is not a member.
- **`not_found`** — 404. No such endpoint under `/api/`. The endpoints are
  listed on [Frontend Data](./store.md).
- **`method_not_allowed`** — 405. The right endpoint, the wrong HTTP method:
  `apply` and `blob` are POST, `blob/<eid>` is GET, `files/<path>` is PUT.
- **`expected_websocket`** — 426. `/api/ws` reached without an upgrade header.
  `subscribe()` in `client.js` does this correctly; a socket written by hand has
  usually left the upgrade header out.
- **`no_bytes`** — 400. An upload with an empty body.
- **`too_large`** — 413. An upload bigger than the app takes: the `maxLength`
  its `vocab.json` says under `"blob"`. Downscale the picture on the page before
  sending it (<https://yaks.app/docs/files.md>).
- **`unsupported_media_type`** — 415. An upload of a type the app does not take:
  its bytes are not one of the types `"blob"` lists in its `vocab.json`.
- **`upload_gone`** — 409. An upload in parts that is no longer in progress
  (seven days passed), or whose parts could not be assembled. POST `blob/<sha>`
  again to start it over; `upload()` in `client.js` does this on its own when a
  part is answered `upload_gone` (<https://yaks.app/docs/files.md>).
- **`no_such_file`** — 404. `blob/<eid>` where the eid is not a sha-256, or
  names bytes this app does not hold.
- **`blob_unavailable`** — 503. The app's store failed while `blob/<eid>` was
  read. Nothing is wrong with the request; ask again.
- **`space_full`** — 413. The space is at its app data ceiling (1 GB on the free
  plan, 10 GB on the Plus plan) or photos-and-files ceiling (1 GB on the free
  plan, 50 GB on the Plus plan). The message says which ceiling, how much the
  space holds and each app's share of it, and what to do; the app itself is not
  broken. File uploads check live storage and only charge growth; duplicates and
  smaller replacements still work. `app_list` says what each app holds as of the
  hourly reading, before a write is refused. Space-owned files in the trash
  still count until erased; shared version snapshots do not.
- **`too_many_reports`** — 429. More than 30 reports from one app in one minute.
  This usually means a page is reporting from a render loop; the endpoint is not
  broken.
- **`refused`** — the store’s status: 400 for invalid input, 403 for a forbidden
  write, 409 for a stale precondition, or 429 for a pace. The message is a
  complete sentence naming the cause: a component or property nobody declared, a
  `$was` that no longer matches, a row that is not theirs to change, a component
  whose `floor` they are below, or one written sooner than its `pace` lets them
  (<https://yaks.app/docs/components.md>). Show the message. A write refused for
  a pace stays in the `outbox` of `client.js`, which sends it again a second
  later until the pace has passed (<https://yaks.app/docs/store.md>), so don't
  send it again yourself.

A refusal is a deliberate answer, so **no refusal is filed as an error**, with
two exceptions where the refusal means the page's own code is wrong: a query the
store cannot read, and a write the app's own `vocab.json` does not allow (a
component or property it does not declare, a string where it declares a number,
a server-owned stamp written back). The page still receives those as `refused`
at 400, and each is also filed as an error in `app_errors`, once for every place
and message. Only the page's own requests are filed: the same refusal of a
request from anywhere else (curl, an agent's own fetch, another site) is for
that caller to read. Otherwise the rule is the status code: a 4xx is a
deliberate refusal, and a 5xx or a thrown exception is an error.

## Showing a refusal on the page

`client.js` throws an error that carries the server's own message, so a `catch`
can show it without composing anything:

    try { await apply(bundle) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

Those two lines are all a page needs. `e.message` is the endpoint's `message`
whole, with no status in front of it, or its `code` when there was no message.
When the body was not a JSON error at all, `e.message` is the status followed by
the first 120 characters of the body's text with any HTML tags removed. Two
answers are like that: the plain-text 429 of a space that has used its monthly
request units, given to anyone who is not one of its signed-in people, and the
platform's HTML error page, a 500, when yaks.app itself fails. `e.status` is the
HTTP status in every case.

`e.signIn` is set only when signing in would allow the request, and the login
page returns to the page they were on. Check it first: a signed-out visitor who
typed something into a `public` app still has their input in the form, and
sending them through the sign-in is the only way to keep it.

Better still, avoid the refusal: `me()`, called on load, reports `reads`,
`writes` and `signIn` before anyone types.

## The error reporter in every page

The platform inserts its **error reporter** into every HTML page it serves,
once, as an inline script: first inside `<head>`, else first inside `<body>`,
else at the end of a document with neither. So the page waits on no request for
it. There is nothing to import and no opt-in. A page whose worker answers with
its own `Content-Security-Policy` has that policy admit the reporter by its
hash. It catches four things:

- **A script error.** The message, the stack, the file and the line.
- **A resource that never loaded** — a script, stylesheet, image, or a module in
  a graph one of them pulled. It listens in the capture phase, because that
  failure fires on the element and does not bubble. This failure matters most:
  the page shows a heading and empty space, and nothing else reports it. Before
  reporting one, the reporter requests that file from the server again. If the
  file answers, the load was interrupted, not missing (the person left the page
  while it loaded, or their connection dropped), and it is not reported. A
  module script that fails to load is reported without that check, since the
  file that failed may be one it imports.
- **An unhandled rejection.** Reported as `unhandled rejection: <the reason>`.
- **A call to one of the app's own `./api/` endpoints that was refused.** It
  wraps `fetch` and watches same-origin responses, passing everything through
  untouched.

Two limits keep the reporter itself from causing problems. It reports at most 20
things per page, so a render loop that throws every frame does not write a
thousand rows. And it only reports what happened on **the app's own origin**: a
404 for a script from another origin, or an analytics beacon an ad blocker
blocked, is not a failure of the app's files.

It filters nothing else. It sends the response's status and body with each
refusal, and the platform applies the rule above: a 4xx is a deliberate refusal
and is not filed.

When an error leaves the page blank, the page shows a full-page "Something went
wrong. Try reloading the page." message in the platform's own colors. It does so
only when the page is bare (under 80 characters of text and nothing that draws
pixels in it, checked after `load` or two seconds, whichever comes first), and
only once. A page that has rendered content is left alone.

The response headers also name the app's report endpoint as a NEL reporting
endpoint, so the browser sends network failures that never reached the page at
all.

## POST ./api/report

The endpoint the error reporter posts to, for a page that wants to file an error
itself:

    POST ./api/report
    content-type: application/json
    {"message": "…", "stack": "…", "url": "…", "line": 12}
    → 204

It also accepts the browser's own Reporting API format — an array of
`{type, url, body}` — for CSP violations, crashes, deprecations and network
errors.

Anyone may post, signed in or not: requiring sign-in would lose the errors that
signed-out visitors hit, which nobody else sees. A malformed body gets a 204 and
writes nothing, because it is the sender's bug, not an error in this app. Past
30 in a minute, per app, it returns 429 `too_many_reports`.

A page rarely needs this; the error reporter already sends everything it would.

## Where errors are filed

Each error is filed as an occurrence in the app’s independent tracker, recording
when it happened, the request, the version the app was serving, the message and
the stack. Page reports and worker failures go through the same intake, so a
broken app store cannot lose its own report. Platform failures are filed in the
platform tracker, not as errors in the person’s app.

`app_errors` reads these occurrences. Reports from before the tracker keep their
existing ids and archive arguments; the tool translates those ids through their
original app store. A new bug also notifies the platform operator by mail.

The person sees them too. Their dashboard (<https://yaks.app/manage>) shows each
app's count of open errors, lists each one in the same wording `app_errors`
uses, and suggests they ask you: "Fix the errors in my Chores app on yaks.app".
Viewing them there does not mark them seen, so you are still told about each
one.

## Unseen errors in tool replies

New errors are added to the end of the next reply from a tool that changes
something, under a heading, one line each. A read-only tool (`app_list`,
`app_versions`, `store_memory_recall`) says nothing about them and leaves them
unseen:

    ## unseen errors
    - #8c0ac745fe 2026-08-14T10:02:11.004Z exception recipes v3:
      /recipes/app.js:12 — boom is not a function (3 times since
      2026-08-14T09:58:40.120Z)
    Each is said once. The next deploy closes them, and the new code reports
    again any it still makes; app_errors(seen: ['all']) closes them without one.

Including them in a reply marks each one seen, so the next reply does not repeat
them. The mark records that you were told, not that anything was fixed:
`app_errors` still lists them. Often the write whose reply includes them is
already the fix (a page that failed to load `app.js` before `app.js` existed),
so there is nothing to dismiss: the deploy that ships it closes them.

Only new errors are included. An error naming a version below the one the app
serves now came from code a later release replaced, and one naming no version at
all predates the version counter; neither is added to a reply. Both are still
open, and `app_errors` still lists them: this rule decides what you are told
about, not what is still broken.

## app_errors

    app_errors(app, fixed?, seen?, space?)

Lists every open error in that app (what a page threw in someone's browser, what
a request threw on the server, what the platform reported), whether or not you
have already been told. Open means not archived.

`fixed` accepts the ids you have fixed and archives them, which is what stops
them showing here and in the unseen block. An id off a line (`#8c0ac745fe`) or a
bare eid both work; a list, or a single one bare. If nothing matched, the call
is refused and the message says so; that is how you learn an error was already
archived.

`seen` archives the same way, for errors you are done with whether or not you
fixed them, and it also accepts a **bound**, so you do not have to list ids one
by one:

- `all` — everything open in the app.
- `v3` — everything up to and including that deploy.
- `2026-08-14`, or a whole instant off a line — everything at or before it. A
  bare day means the end of that day.

Ids work there too, so one call can mix them. An error naming no version is
covered by any version bound, and one naming no time by any time bound, since
there is no way to tell whether those are still happening.

Archiving is a write, so it needs write access. Reading the list does not: a
viewer of the space can still see what is broken.

Each occurrence is kept, and the occurrences of one error (the same place and
the same message) are shown as one line: the newest one's id and time, and how
many times it happened since the first. A render loop that threw twenty times is
one thing to fix, and archiving the line's id archives all twenty. The place is
the app's own file and line, `/recipes/app.js:12`, the file you wrote.

You will rarely archive by hand, because **a new release closes the errors from
older releases.** Every `app_deploy`, `app_install` and `app_rollback` archives
every open error from a version other than the one now live (and every one that
names no version at all, since nothing can tell whether those are still
happening); the deploy's reply reports how many. An `app_files` write stays in a
private draft until deploy, so a page's "failed to load app.js" is fixed when
that deploy succeeds. An error the new files still produce is filed again the
next time it happens.

## app_versions

    app_versions(app, space?)

Lists every deploy, newest first, with when it went out and what changed in it.
An app keeps its last **20**.

    yourname/recipes: 3 versions
    - v3 (live) 2026-08-14T10:01:00.000Z — changed index.html
    - v2 2026-08-13T18:40:12.000Z — restored v1, changed index.html, style.css
    - v1 2026-08-13T09:12:44.000Z — 4 files

A version is a manifest — each path against the sha-256 of its bytes — not a
copy of the bytes, so a file unchanged across twenty deploys is stored once.
That is also how a deploy that puts earlier files back knows to report
`restored v1`: its files differ from the version directly below it, and match
some earlier version exactly.

Below the versions, each move of the live pointer is a line of its own, newest
first: `moved v3 → v2 2026-08-14T11:20:00.000Z by you`, from a deploy, an
install or an `app_rollback`, and who made it.

Read it when the person says the app used to work, so you name the version they
mean.

## app_rollback

    app_rollback(app, version?, space?)

Makes an earlier version live again. Leave `version` out for the deploy before
the live one: when the person says "that change broke it", they almost always
mean the version before the newest. Name one from `app_versions` for anything
else.

What changes: the live pointer selects the kept release's immutable files and
worker. Its vocabulary and commands are selected together under the store's
additive schema rules. A legacy version without its own source is prepared from
pinned bytes before switching; its deploy record stays unchanged.

What never changes: the app's data, meaning every row, every upload and
everything else the store holds. Only the release (files, worker, vocabulary and
commands) changes.

A rollback moves the live pointer to a kept version. It creates no new version
and leaves every stored deploy unchanged, including copies older rollbacks
created. Each pointer move records its source and target deploy, time, actor and
session (when identifiable). `app_versions` shows these moves and marks the
version now live. To undo, name the version you left in another `app_rollback`.
Errors and reload notices name the version whose bytes run.

    put yourname/recipes back to v2, live now:
    https://yourname.yaks.app/recipes/ — changed index.html

Two refusals: an app with one deploy or none has nothing earlier to go back to,
and a version number the app no longer keeps is refused, with the ones it does
keep listed in the message. Pruning past the last 20 deletes only bytes no kept
version names, so the oldest rollback an app still offers always has its files.

## app_delete and app_restore

    app_delete(app, space?, forever?)
    app_restore(app, space?)

A rollback undoes a deploy; a restore undoes a **delete**. `app_delete` does not
erase anything. It puts the app in the trash and keeps every byte of it: its
files, its store, its deploys, and its slug, which stays reserved so a restore
brings the app back exactly as it was, at the same address.

What changes as soon as it is in the trash: its address answers nothing on the
web, its commands stop being offered and its views leave your resource list, it
is nobody's front page even if it was one, email to its mailbox bounces, and its
wakes stop firing. What does not change: anything it saved.

`app_restore` takes it out of the trash and restores all of that. A wake that
came due while it was in the trash fires once, the same way any missed period is
caught up, and then continues at its cadence. The trash keeps it for 30 days;
`app_list` lists what is in the trash with the days each one has left, and the
person can restore one from their space's own page without an assistant at all.
After 30 days the platform erases it, and then there is nothing to restore.

    app_delete(app: 'scratch')
    → yourname/scratch is in the trash. https://yourname.yaks.app/scratch/ stops
      answering and its commands have gone with it; nothing it saved was
      touched.

Two things to know before you call it. The slug is held for the whole 30 days,
so `app_new` at that address is refused, with the reason. Restore it or erase
it, but do not build a second app at the address of one the person may want
back. And `forever: true` skips the trash: files, data and address gone with no
undo. Use it only when the person has said they mean exactly that.

## space_delete and space_restore

    space_delete(space, forever?)
    space_restore(space)

A whole space goes into the same 30-day trash, with the same guarantees: nothing
is erased, every app in it is kept whole, and the address is held so nobody else
can take it. While it is in the trash, every hostname of the space answers
nothing, its apps stop offering their commands and their pages and fire none of
their wakes, and email to any address under it bounces. `space_restore` takes it
out of the trash and all of that works as it did before.

`space_delete` is the one deletion **you cannot complete yourself**. It mails
the owner a link, good for an hour, and reports what that link would take
offline; tell them to check their email. They can also do it themselves, signed
in, at `https://yaks.app/space/<slug>/delete`.

    space_delete(space: 'oldlab')
    → nothing is deleted. oldlab is still there, and an assistant cannot delete
      a space: a letter is on its way…

The person restores it from the space's own address: signed in,
`https://<slug>.yaks.app/` is the one page a trashed space serves, and it has
the restore button. `space_new` at that slug is refused for its owner, with the
reason. `forever: true` mails a link that erases the space on the spot instead,
with nothing kept: only when the person has said they mean exactly that.

## Undoing mistakes

Every destructive action on yaks.app can be undone, and each tool's own
description ends by naming how. There are four ways, at four scopes:

- A deleted app or space is in the trash for 30 days, above, and `app_restore`
  or `space_restore` brings the whole thing back: files, data, address.
- A store can be restored to any moment in the last 30 days. `store_restore`
  returns everything the app has saved to how it was at a time you name: a bad
  import, rows deleted that should not have been. The state before the restore
  is recorded first, so a restore can itself be undone by restoring to a moment
  just before it, and the answer says how. Call it with no time and it reports
  the window and every restore already made.
- Every file write keeps what it replaced for 30 days, and
  `app_files(op: 'history', path)` and `app_files(op: 'restore', path)` list and
  put one back (<https://yaks.app/docs/files.md>).
- Every deploy can be rolled back, above.

So fix things first and ask afterwards, rather than the other way round. A
change is cheap to try, so there is no reason to stop and ask permission before
every write. When the person hesitates ("will I lose everything?"), tell them
which of these covers them. Usually the risk they are worried about does not
exist.

Only what somebody explicitly asked to erase cannot be undone:
`app_delete(forever: true)` skips the trash, and disconnecting a connection
deletes its key, so the person has to connect it again.

## feedback

    feedback(text, app?, space?)

The tool for **all** feedback about the platform: this connector, its tools, its
guide, the way an app is built or served on yaks.app. A tool that refused for no
reason you could find, a tool that is missing, a reply that disagreed with what
was documented, a step the person found baffling; and equally a rough edge, a
wish, a feature idea, a thing that went well. Send it whether you ran into it
yourself or the person said it.

Send it as soon as it comes up. Where something on the platform is broken, work
around it and carry on: nobody at yaks.app sees the workaround, so feedback is
how they learn about the problem.

Send two things and nothing else: **what the person said, in their own words,
and what you tried and what happened.** Who they are, their address, their
space, the app if you name one, its version, the platform's release and the time
are attached automatically. Repeating them only adds text the reader already
has.

It writes a report in the platform's own store and mails it to the people who
run yaks.app, who can write back to the person's address. If the mail cannot go
out, the report is kept and the reply tells you so — no need to send it again.

The limit is three an hour, per person. A fourth is deferred, not refused: the
reply says so and gives the address to write to directly if it cannot wait.
Feedback is not counted against the space's monthly email ceiling, so a space at
its ceiling can still send feedback.

**An error in the person's own app is not platform feedback.** It is already in
`app_errors`, and fixing it is your job.

---

The whole guide: <https://yaks.app/docs.md>
