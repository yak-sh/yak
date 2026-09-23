---
doc:
  title: Publishing and installing an app
guide:
  slug: sharing
  brief: publishing and installing an app
  description: >-
    Who may read and write an app, how somebody is invited to one app rather
    than the whole space, and how an app travels: app_publish, app_install
    and app_update, what an installed copy shares (the code, and nothing
    else), how it runs like the space's own apps and the sandbox its owner
    can put it in, what pinning means, and what an update does to what
    people saved.
---

# Publishing and installing an app

Two different questions get answered here. Who may read and write one app — its
`access`, and its guest list. And how an app becomes a plugin anybody can take a
copy of — `app_publish`, `app_install`, `app_update`, what a copy shares, and
what an update does to what people already saved.

## Access: what a stranger with the link can do

Every app has one of three access settings. `app_new(access:)` sets it when the
app is made, `app_set(access:)` changes it later, and both report what it means
in the person's own terms, so you can repeat it back to them.

**`public`** — the default. Anyone with the link reads the app and its data.
Only members write. A stranger's write is refused 401 with `not_a_writer` and a
`signIn` address that comes back to the page they were on; a signed-in viewer's
write is refused 403, because signing in is no longer the way through — the
owner's is.

**`open`** — anyone with the link adds to it too, signed in or not. This is what
a vote page, a guest book or a signup sheet needs. A visitor (anyone the app
lets write who is not its owner or an editor) adds rows, and changes or deletes
only the rows they wrote; everybody else's rows are refused to them. The owner
and editors change anything, as ever. A shared list that visitors tick off
together is therefore a list whose ticks are rows of their own, one per tick,
rather than an edit to somebody else's item.

A visitor is also held to a visitor's size and pace: 16 KB in one write, 2 MB in
one upload, and 30 writes and uploads a minute to one app, counted per signed-in
person or, signed out, per address. Past that the answer is 413
`visit_too_large` or 429 `too_many_writes` (<https://yaks.app/docs/errors.md>).

Three of the platform's own words stay out of a visitor's reach whatever the
access: `product` is written by the owner and editors, an `order`'s columns only
by the platform (<https://yaks.app/docs/selling.md>), and the ask to send a
letter, `deliver`, by the owner and editors (<https://yaks.app/docs/mail.md>).

The cost of letting anyone in is a byline: a guest who never signed in is nobody
yet, so their rows carry no `created.by` at all, and a row nobody signed is
nobody's to change again. If the page wants to show who said what, it has to ask
for a name on the page and save it in its own row.

    let who = await me()
    if (!who.writes) show(`<a href="${who.signIn}">Sign in to post</a>`)
    else if (!who.person) show('<input name="who" placeholder="Your name">')

Ask on load, not on refusal — that is the whole reason `me()` exists.

**`private`** — members only, either way. The page itself is part of what only
they see: a signed-out stranger asking for it is sent to the login page (303)
holding that page as its return address, and someone signed in who is not a
member of the space gets the same "Nothing here yet." a wrong address gets —
whether the app exists at all is its owner's to tell. The app's `/api/`
endpoints answer `not_a_reader` rather than pretending.

The app's own `worker.js` is the exception, and the only one: it runs before
that redirect, so a private app with a worker is an app whose gatekeeper is its
own code. That is how a rule finer than one of the three settings gets written —
an invitation code that opens one household's row and no other. See `env.APP` in
[Code of your own](./code.md).

One rule sits above all three: **writing an app's files is always a member's
act**, whatever the app lets its visitors save into its store. An `open` app
accepts a guest's rows and never a guest's deploy.

## The guest list

    member_add(email, app?, name?, note?, role?, space?)
    member_remove(email, app?, space?)

Only the space owner may invite; an editor writes the app's data and its files
but does not hand out keys.

`role` is `editor` (the default: reads and writes), `viewer` (reads only), or
`owner` (may also invite). Inviting an address that is already a member changes
their role, and the answer reports what it was before.

An invitation is pending until its person accepts it, with the one click in the
letter, signed in with the address it went to. Until then nothing of the space
is in their reach: it is not in their listing, a bare app name never resolves to
it, and their agent is told nothing about it. `member_remove` withdraws a
pending invitation the same way it removes a member.

## One app, or the space

`app` is the whole of the difference, and it is a difference in what they get:

**Name it** and they are a guest of that one app. They open its page and read
and write its data exactly as a member does, and the rest of the space is not
theirs — its private apps are a wrong address to them, its public ones are what
a stranger with the link sees. This is how a player joins one game, a household
opens one list, a client sees one project. They are not on the space's member
list at all, so they have no space to list and nothing of yours to browse.

    member_add(email: 'player@example.com', app: 'idler-rpg', role: 'editor')
    member_remove(email: 'player@example.com', app: 'idler-rpg')

**Leave it out** and they take a seat on the whole space, which reaches every
app in it, now and every one you make later. That is a collaborator, not a
guest.

Two things a guest never gets, whatever role the invitation gave them. The app's
files — writing an app's files stays a member's act, so an app accepts a guest's
rows and never a guest's deploy. And a way in for their agent: a guest is
somebody who opens a page, not somebody whose connector lists your apps.

Inviting a member to one app is refused rather than quietly demoting them: take
the seat back with `member_remove` first, and then the invitation is that app
alone.

Those three roles come from the space's member list, and a guest's grant uses
the same three. What `me()` returns as `role` is what the caller holds on the
app they are looking at — their seat on the space where they have one, their
grant on that app where they do not. Inside an app's own store, `member` is a
different thing again: two roles, `owner` and `member`, recording whether
someone belongs. Write both with `member_add`, never by hand.

The letter follows `app` too: name it and the invitation carries that app's own
link, leave it out and it carries the space's own address, which is its front
page when it has one and a list of the apps they may open when it does not.

`name` is what to call them — their apps show it beside what they write, so
nobody sees an address. Left out, their first sign-in asks them. It never
renames someone who has already chosen.

`note` is the inviter's own message, carried at the top of the letter, quoted
and attributed to them so nobody reads it as the platform speaking. A line or
two — 500 characters is the cap, and past it the call is refused rather than
sending half a sentence in somebody's name. Read it back to the person before
you send it: it is going out over their name.

Its subject is always "You have an invitation on yaks.app". The body names who
invited them and what to, and carries the accept link. Clicking it signed in as
that address accepts and lands them on the page it names; anyone else is asked
to sign in with that address first, and the sign-in brings them back to accept.
There is nothing to install and no account to make first.

The accept link goes only to the invited address, so the answer never hands you
one. If the letter cannot go, the invitation stands and asking again sends it.

Each invitation letter counts against the space's monthly emails, and one person
may send 50 invitations an hour. Changing the role of somebody who has already
accepted sends nothing and counts nothing.

`member_remove` refuses to remove the last owner: a space with nobody to decide
who belongs is one nobody can open again. Removing someone leaves their sign-in
intact — they lose this space, not the platform. Naming an app,
`member_remove(email, app)`, takes back that one app and leaves the rest.

## Publishing

An app is a plugin. Once it is deployed you can offer it to every other space on
yaks.app, and anyone can take a copy into their own.

**`app_publish(app, name?, about?, space?)`** — offer the version that is
serving now.

- The app must have been deployed. An app at v0 serves nothing an installer
  could copy, and publishing it is refused.
- `name` is the address the whole platform installs by. On a first publish it
  defaults to the app's own slug. On a republish it defaults to **the name the
  offer already has** — a republish never quietly renames — and passing an
  explicit `name` moves it, which leaves the old name resolving to nothing for
  everyone who was told to install it. The answer reports which of the three
  happened, in those terms, because a rename is the half nobody can see.
- A name taken by somebody else's app is refused, naming the app that holds it.
  One name, one app, platform-wide.
- `about` is the line someone browsing reads. Leave it out on a republish and
  the previous one stands.
- Only the **space owner** may publish. Publishing hands the code to strangers,
  so it is not an editor's call.
- **A later `app_deploy` does not move the offer.** The offer stays pinned to
  the version you published, so installers keep getting that code until you
  `app_publish` again. That is deliberate — an editor's deploy must not change
  what the whole platform installs — and the deploy that leaves the offer behind
  reports it in its answer. `app_versions` marks which version is `(live)` and
  which is `(offered)`.

**`app_unpublish(app, space?)`** — withdraw the offer. The app is untouched,
every copy anyone took is untouched and keeps working, and the name is free
again. Refused if the app was not published.

**`app_published()`** — what is on offer, newest first. One line each:

    - tally v1 — Tally: Count the votes (from yourname/tally, installs as
      tally, published 2026-08-14)

Read it before you build something somebody may already have made.

**`app_install(name, as?, space?)`** — take one.

- `name` is the published name from `app_published`.
- The address the copy lands at is, in order: `as` if you passed it; else the
  source app's own slug, if nothing in the space holds that address; else the
  published name. The source's slug goes first on purpose — an app is written at
  its own address, and a copy that reads like the app is easier to reason about.
  (A page written relatively works either way; the platform gives every page a
  `<base href>` pointing at the app's own address.)
- An address already taken in the space — by an app, or by an address an app has
  moved away from and still redirects from — is refused, telling you to pass
  `as`.
- An installed app counts against the space's app ceiling like any other (the
  free tier allows five, Plus allows 50; trashed apps do not count).
- The copy keeps the published app's `access`: an app written to be voted on has
  to stay votable. `app_set` changes it afterwards.
- The copy is not made the front page: `<space>.yaks.app/` lists the space's
  apps until somebody sets which app opens there (`app_set(app, home: true)`).
- The install ends in a release of the copy: its `vocab.json` installed in its
  own store, its `tools.json` listed under its own slug, its `worker.js`
  uploaded as its own script. So the answer carries the deploy's own lines —
  components, tools, worker — under the install's.

The answer names the address, the file count, and the pin:

    installed tally v1 as ann/tally: https://ann.yaks.app/tally/ — 2 files,
    its own store and its own data, pinned to that version (app_update
    moves it)

**`app_update(app, space?)`** — move an installed copy to whatever its publisher
offers now. Below.

## The gallery: being shown

Publishing makes an app installable. The gallery is the other half — being
shown, on <https://yaks.app/gallery>, a public page of what people have made on
yaks.app. They are deliberately two separate acts: an offer is between whoever
made the app and whoever goes looking for one, and a listing is yaks.app putting
somebody's app on its own front page.

**`app_publish(app, gallery: true)`**, or **`app_set(app, gallery: true)`**
later, puts a published app forward. Only when the person has said they want it
shown: it is their app, their name and their address on a public page, so it is
never something to assume. The app must be published — a gallery entry nobody
can install is a picture of an app.

It is not listed on the spot. Asking sends a letter to yaks.app carrying the
app's title, its address, the line its owner wrote about it and who made it,
with two links to answer by. Nothing appears anywhere until somebody at yaks.app
opens the link that approves it. That is the whole design and it does not have a
faster path: the page is ours, under our name.

The tool reports where it stands, and so does the app's pill on the space's own
page:

    not in the gallery
    waiting on us: it is not listed until we say yes, and a letter is on its
      way to the desk that decides
    listed in the gallery — https://yaks.app/gallery

**Taking it back** is `app_set(app, gallery: false)`, and it is immediate. So is
`app_unpublish`: an app nobody can install is not on the page. Both clear the
ask as well as the listing, so putting it back later asks yaks.app once more.

**Deleting** it takes it off the page at once too, and that one is different:
nothing is written. A trashed app — and every app in a trashed space — simply
stops being shown, and `app_restore` puts the listing back exactly as it was,
with nobody asked twice.

**`gallery_search(words, limit?)`** searches the listings, matching your words
against each one's name and the line its maker wrote. It needs no account —
signed out, it is one of the few tools this connector answers at all — and each
result carries the `app_install` line that gives the person their own copy. Read
it before building something from scratch.

    - Tally — Count the votes
      https://yourname.yaks.app/tally/
      app_install(name: 'tally')

## What a copy shares: the code, and nothing else

An installed app is an ordinary app of the installer's. Its own address, its own
store, its own file prefix, its own worker script, its own version history
starting at v1. Their first row goes into a graph nobody else has ever touched.
Nothing is synced, nothing phones home, and the publisher never sees any of it.

What travels is the app's own files — the pages, the stylesheets, the
`vocab.json`, the `tools.json`, the `worker.js`. What does not:

- **Data.** Every row the publisher's copy holds stays there.
- **Uploads.** The photos a visitor sent to the publisher's copy are that app's
  data, not its code, and stay behind.
- **Version history.** The copy earns its own from the release the install
  makes.
- **Secrets.** They live on the script, and the copy's script is new. An app
  that needs a key should say so in its `about`, and the installer sets their
  own with `app_secret_set`.
- **Members.** The copy belongs to the installer's space and its guest list.

## How an installed app runs

An installed app runs like the space's own apps. It is served at
`<space>.yaks.app/<app>/` on the space's origin, with the browser's own
`localStorage`, `sessionStorage`, IndexedDB and the sign-in cookie, and its
words are shared with the space's other apps the way theirs are. Like them, it
can read and change everything in the space the person using it can: the space
is the trust boundary.

**The sandbox, as an option.** The space's owner can wall one installed app off:
`app_set(app, sandboxed: true)`, and `sandboxed: false` lets it out again. Every
answer it gives then carries
`Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups`, so
the browser runs it in an origin of its own. What changes:

- **Its API hears a token, never the cookie.** The page's `<base href>` is
  `/<app>/~<token>/`, so relative paths work (`./app.js`,
  `import './api/client.js'`) and an absolute `/<app>/app.js` does not load.
- **Storage is the platform's.** `localStorage` keeps each signed-in person's
  keys in the app's store, up to a megabyte; `sessionStorage` lasts as long as
  the page. IndexedDB, `document.cookie` and service workers are refused, and so
  is the camera (and in Chrome, notifications).
- **It reaches nothing else in the space.** Another app's address sees it as a
  stranger, its `/api/files/` endpoint refuses it, and from its next release
  (`app_deploy`) its words are planted in its own store and no other app borrows
  from it.

## What pinning means

A copy is **pinned** to the version it took. Publishing again does not move
anybody: the installer's copy keeps serving exactly what it served yesterday
until someone calls `app_update`. That is the whole point — a publisher cannot
change an app out from under the people using it, and an app someone is relying
on does not change while they sleep.

`app_published` shows the version on offer; the copy's own `app_list` line shows
the version it is at.

## What an update does

`app_update` replaces the code and keeps the data.

**Before a byte moves**, the publisher's `vocab.json` is checked against the
copy's store. A vocabulary that only grew is applied additively. One that would
retype a column the copy's rows were written under is refused with the same
message a deploy gives — `vote.count is already number` — and nothing moves at
all: not the files, not the pin. The copy is exactly as it was.

Then every file of the publisher's version is written over the copy, and **every
file the copy has that the publisher does not is deleted.** That includes
anything you wrote into the copy yourself — a tweak to its stylesheet, a page
you added. What serves after is what the publisher wrote.

Then the copy is released like any deploy: components installed, commands
registered, `worker.js` uploaded, a new version recorded, and breaks from
earlier versions closed. Then the pin moves.

What survives, always: every row they saved, every file they uploaded, and
anything the store learned along the way. The answer confirms that, and reports
how many files were written and how many removed.

Three refusals worth knowing:

- The app was not installed from anywhere — it is their own app, and
  `app_deploy` releases what you write in it.
- The app it came from is no longer published — the copy keeps working, data and
  all, and there is nothing to update it to.
- It is already at that version — answered, not refused: "nothing to update".

## Before you build

`app_published()` is one call and costs nothing. When the person asks for
something ordinary — a vote page, a chore chart, a signup sheet — look first.
Installing takes a second, gives them their own copy with their own data, and
you can `app_files` their copy afterwards to make it theirs. The only thing an
install costs is one of the space's app slots.

---

The whole guide: <https://yaks.app/docs.md>
