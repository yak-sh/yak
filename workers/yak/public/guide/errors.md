# When something breaks

Nothing here is swallowed. This page is what a refused call answers and how a
page shows it, what the reporter in every page catches on its own, where a break
is filed and how you hear about it once, `app_errors`, `app_versions` and
`app_rollback`, and `feedback` for anything either of you has to say about the
platform itself.

## A refusal

Every door refuses in one shape — a code for the machine, a sentence for the
person:

    {"error": {"code": "not_a_writer", "message": "sign in to change this app"}}

When signing in is the way through it carries a third field, `signIn`: the
platform's login page already holding this page as its return address.

The codes a door answers, with what each means:

- **`not_a_writer`** — 401 signed out, with `signIn`; 403 signed in. The app's
  `access` does not take a write from this person. Signed out, send them to
  `signIn`. Signed in, it is the owner's to grant — the sentence says so.
- **`not_a_reader`** — 401 signed out, with `signIn`; 403 signed in. A `private`
  app answering someone who is not a member.
- **`not_found`** — 404. No such door under `/api/`. The message lists the ones
  that exist: apply, query, me, graph, ws, blob, files/`<path>`.
- **`method_not_allowed`** — 405. The right door, the wrong verb: `apply` and
  `blob` are POST, `blob/<eid>` is GET, `files/<path>` is PUT.
- **`expected_websocket`** — 426. `/api/ws` reached without an upgrade header.
  `subscribe()` in `client.js` does this correctly; a hand-rolled socket usually
  forgot.
- **`no_bytes`** — 400. An upload with an empty body.
- **`too_large`** — 413. One upload over 20 MB. Downscale the picture on the
  page before sending it.
- **`no_such_file`** — 404. `blob/<eid>` where the eid is not a sha-256, or
  names bytes this app does not hold.
- **`space_full`** — 413. The space is at the free tier's data ceiling. The
  message says which ceiling and what to do; the app is fine.
- **`too_many_reports`** — 429. More than 30 reports from one app in one minute.
  A page in a render loop, not a broken door.

A refusal is somebody's deliberate no, so **none of them is filed as a break.**
The rule is the status: 4xx is a choice, 5xx and a throw are not.

## How a page shows one

`client.js` throws the server's own sentence, so a `catch` has something to show
without composing anything:

    try { await apply(bundle) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

Those two lines are the whole of it. `e.message` is the door's `message`, or its
`code` if there was no sentence, or `<status> <a short line>` when the body was
not a refusal at all — a 404 that answered the platform's HTML page, say, which
never gets dumped into an error message.

`e.signIn` is set only when signing in is the way through, and the login page
comes back to the page they were on. Check it first: a signed-out visitor who
typed something into a `public` app has their work sitting in the form, and
sending them through the sign-in is the only path that keeps it.

Better still is not to be refused. `me()` on load says `reads`, `writes` and
`signIn` before anyone types.

## The reporter

The kernel injects `./api/report.js` into every HTML page it serves — first
inside `<head>`, else first inside `<body>`, else at the end of a document with
neither, and once. There is nothing to import and no opt-in. It catches four
things:

- **A script error.** The message, the stack, the file and the line.
- **A resource that never loaded** — a script, stylesheet, image, or a module in
  a graph one of them pulled. It listens in the capture phase, because that
  failure fires on the element and does not bubble. This is the one that hurts
  most: a page paints a heading and empty space and nothing else says so.
- **An unhandled rejection.** Reported as `unhandled rejection: <the reason>`.
- **A call to the app's own doors that came back a no.** It wraps `fetch` and
  watches same-origin answers, passing everything through untouched.

Two limits keep it from becoming the problem. It reports at most 20 things per
page, so a render loop that throws every frame does not write a thousand rows.
And it only reports what happened on **the app's own origin** — a script from
somewhere else that 404'd, or an analytics beacon an ad blocker refused, was
never the app's file.

It judges nothing else. It sends the answer's status and body along with each
door refusal, and the platform applies the one rule: a 4xx was somebody's choice
and files nothing.

When a break leaves the person looking at nothing, the page says so itself — a
full-page "Something went wrong. Your assistant has been told." in the
platform's own colors. Only when the page is bare: under 80 characters of text
and nothing that draws pixels in it, judged after `load` or two seconds,
whichever comes first, and only once. A page that painted is left alone.

The response headers also name the app's report door as a NEL reporting
endpoint, so the browser sends network failures that never reached the page at
all.

## POST ./api/report

The door underneath, in case a page wants to file something itself:

    POST ./api/report
    content-type: application/json
    {"message": "…", "stack": "…", "url": "…", "line": 12}
    → 204

It also takes the browser's own Reporting API shape — an array of
`{type, url, body}` — for CSP violations, crashes, deprecations and network
errors.

Anyone may post: a break belongs to whoever was looking at the page, and asking
a stranger to sign in first would lose exactly the breaks nobody sees. Junk
answers 204 and writes nothing — a malformed body is the sender's bug, not a
break in this app. Past 30 in a minute, per app, it answers 429
`too_many_reports`.

A page rarely needs this. The reporter above already covers everything it would
send.

## Where a break is filed

An `exception` entity in **the app's own store**, carrying `at`, the `request`
it happened on, the `version` the app was serving, the `message` and the
`stack`. Every source of a break writes the same shape: a page reporting itself,
a route that threw on the way in, and a worker that answered 5xx.

The version is read past the directory's cache on purpose. The likeliest moment
for a break is right after a deploy, and it must name the release it happened on
and not the one before.

An exception wears no `doc`, and a listing leaves `exception` and `error` rows
out unless the filter names one — `.doc!` is the person's own rows and never the
platform's crashes. Asking for the stamps is not asking for these: `.created!`
alone does not drag them in. When you want them from a query rather than from
`app_errors`, name them: `.exception!`.

## Hearing about it once

New breaks ride the end of your next tool reply, under a heading, one line each:

    ## unseen errors
    - E-84 2026-08-14T10:02:11.004Z exception recipes v3: page /recipes/ —
      boom is not a function

Serving them stamps each one, so the next reply is quiet about them. That mark
is the delivery, not a fix: `app_errors` still lists them.

Only what is still **news** rides along. A break naming a version under the one
the app serves now was made by code a later release replaced, and one naming no
version at all predates the counter; neither interrupts a reply. Both are still
open, and `app_errors` still lists them — this decides what is worth saying, not
what is true.

## app_errors

    app_errors(app, fixed?, seen?, space?)

Everything still open in that app — what a page threw in someone's browser, what
a request threw on the way, what the platform reported — whether or not you have
already been told. Open means not archived.

`fixed` takes the ids you have fixed and archives them, which is what stops them
showing here and in the unseen block. An id off a line (`E-84`) or a bare eid
both work; a list, or a single one bare. Nothing matched is refused, saying so —
that is how you learn one was already archived.

`seen` archives the same way, for breaks you are done with whether or not you
fixed them, and it takes a **bound** so you never have to list six ids:

- `all` — everything open in the app.
- `v3` — everything up to and including that deploy.
- `2026-08-14`, or a whole instant off a line — everything at or before it. A
  bare day means the end of that day.

Ids work there too, so one call can mix them. A break naming no version goes
with any version bound, and one naming no time with any time bound: nothing can
say whether those are still true.

Archiving is a write, so it needs a writer. Reading the list does not: a viewer
of the space still gets to see what is broken.

It also draws itself where the person can see it, folding breaks that share an
app, a message and a place into one card with a count — a render loop that threw
twenty times is one thing to fix — with a button on each that calls the tool
back to archive the whole fold.

You will rarely archive by hand, because **new bytes close what the old ones
broke.** Every `app_deploy`, `app_install` and `app_rollback` archives every
open break from an earlier version (and every one that names no version at all,
since nothing can say whether those are still true); the deploy's answer says
how many. And every `app_files` write archives the open breaks that named the
files it just wrote — a page's "failed to load app.js" is answered by writing
app.js, without waiting for a deploy, because the files serve live. A break the
new bytes still produce is written again the next time it happens.

## app_versions

    app_versions(app, space?)

Every deploy, newest first, with when it went out and what changed in it. An app
keeps its last **20**.

    jeff/recipes: 3 versions
    - v3 (live) 2026-08-14T10:01:00.000Z — changed index.html
    - v2 2026-08-13T18:40:12.000Z — restored v1, changed index.html, style.css
    - v1 2026-08-13T09:12:44.000Z — 4 files

A version is a manifest — each path against the sha-256 of its bytes — not a
copy of the bytes, so a file unchanged across twenty deploys is stored once.
That is also how a version made by a rollback knows to say `restored
v1`: its
files are not the ones under it, and are exactly some earlier version's.

Read it when the person says the app used to work, so you name the version they
mean.

## app_rollback

    app_rollback(app, version?, space?)

Puts the app back the way it was. Leave `version` out for the deploy before the
live one — "that change broke it" almost always means the one under the newest.
Name one off `app_versions` for anything else.

What moves: every file that version named, restored from its pinned bytes, and
every file the app has now that the version did not name, deleted. Then the
whole release runs again over those files — the components its `vocab.json`
declares, the commands its `tools.json` declares, its `worker.js` re-uploaded —
because everything a deploy plants is a file, so restoring the files is the
whole of a rollback.

What never moves: the app's data. Every row, every upload, everything the store
learned. Only the files.

A rollback goes out as a **new version**, so nothing is lost and a rollback can
itself be rolled back. The answer names both numbers:

    put jeff/recipes back to v2, live now as v4:
    https://jeff.yaks.app/recipes/ — changed index.html

Two refusals: an app with one deploy or none has nothing earlier to go back to,
and a version number the app no longer keeps is refused listing the ones it
does. Pruning past the last 20 deletes only bytes no kept version names, so the
oldest rollback an app still offers always has its files.

## app_delete and app_restore

    app_delete(app, space?, forever?)
    app_restore(app, space?)

The undo of a deploy is a rollback; the undo of a **delete** is a restore.
`app_delete` does not erase anything. It puts the app in the trash and keeps
every byte of it: its files, its store, its deploys, and its slug, which stays
reserved so a restore is exact rather than approximate.

What changes the moment it goes in: its address answers nothing on the web, its
commands stop being offered and its views leave your resource list, it is
nobody's front page even if it was one, and letters to its mailbox bounce. What
does not change: anything it saved.

`app_restore` takes it back out and puts all of that back. You have 30 days;
`app_list` shows a Trash section with the days each one has left, and the person
can restore one from their space's own page without an assistant at all. After
30 days the platform erases it, and then there is nothing to restore.

    app_delete(app: 'scratch')
    → jeff/scratch is in the trash. https://jeff.yaks.app/scratch/ stops
      answering and its commands have gone with it; nothing it saved was
      touched.

Two things to know before you call it. The slug is held for the whole 30 days,
so `app_new` at that address is refused and says why — restore it or erase it,
but do not build a second app on top of one the person may want back. And
`forever: true` skips the trash: files, data and address gone with no undo. Use
it only when the person has said they mean exactly that.

## space_delete and space_restore

    space_delete(space, forever?)
    space_restore(space)

A whole space goes to the same 30-day trash, and the same words are true of it:
nothing is erased, every app in it is kept whole, and the address is held so
nobody else can take it. While it sits there every hostname of the space answers
nothing, its apps stop offering their commands and their pages, and letters to
any address under it bounce. `space_restore` takes it back out and every one of
those is the old answer again.

`space_delete` is still the one tool **you cannot do**. It mails the owner a
link, lasting an hour, and answers with what that link would stop; tell them to
check their email. They can also do it themselves, signed in, at
`https://yaks.app/space/<slug>/delete`.

    space_delete(space: 'oldlab')
    → nothing is deleted. oldlab is still there, and an assistant cannot delete
      a space: a letter is on its way…

The person restores it from the space's own address — signed in,
`https://<slug>.yaks.app/` is the one page a trashed space serves, and it has
the button. `space_new` at that slug is refused for its owner and says why.
`forever: true` mails a link that erases the space on the spot instead, with
nothing kept: only when the person has said they mean exactly that.

## feedback

    feedback(text, app?, space?)

The door for **all** feedback about the platform — this connector, its tools,
its guide, the way an app is built or served here. A tool that refused for no
reason you could find, a door that is not there, an answer that disagreed with
what was documented, a step the person found baffling; and equally a rough edge,
a wish, a feature idea, a thing that went well. Whether you ran into it yourself
or the person said it, it is wanted.

Reach for it the moment it comes up. Where something is broken, work around it
and carry on: nobody sees the workaround, and this is what is seen instead.

Send two things and nothing else — **what the person said, in their own words,
and what you tried and what happened.** Who they are, their address, their
space, the app if you name one, its version, the platform's release and the time
all ride along on their own. Repeating them wastes the reader's attention on the
half they already have.

It writes a report in the platform's own store and mails it to the people who
run yaks.app, who can write back to the person's address. If the mail cannot go
out, the words are kept and the answer says so — no need to send it again.

Three an hour, per person. The fourth is a pause, not a no: the answer says so
and names the address to write to directly if it cannot wait. Feedback is not
counted against the space's monthly email ceiling — a space at its ceiling is
exactly a space with something to say.

**A break inside the person's own app is not this.** That one is theirs, it is
already in `app_errors`, and fixing it is yours.

---

The whole guide: <https://yaks.app/guide.md>
