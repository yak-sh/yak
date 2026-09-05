# Publishing and installing an app

Two different questions get answered here. Who may read and write ONE app — its
`access`, and its guest list. And how an app becomes a plugin anybody can take a
copy of — `app_publish`, `app_install`, `app_update`, what a copy shares, and
what an update does to what people already saved.

## Access: what a stranger with the link can do

Every app carries one of three words. `app_new(access:)` sets it at birth,
`app_set(access:)` changes it later, and both answer with what it means in the
person's own terms, so you can repeat it back to them.

**`public`** — the default. Anyone with the link reads the app and its data.
Only members write. A stranger's write is refused 401 with `not_a_writer` and a
`signIn` address that comes back to the page they were on; a signed-in viewer's
write is refused 403, because signing in is no longer the way through — the
owner's is.

**`open`** — anyone with the link writes too, signed in or not. This is what a
vote page, a shared list or a signup sheet needs. The cost is a byline: a guest
who never signed in is nobody yet, so their rows carry no `created.by` at all.
If the page wants to show who said what, it has to ask for a name on the page
and save it in its own row.

    let who = await me()
    if (!who.writes) show(`<a href="${who.signIn}">Sign in to post</a>`)
    else if (!who.person) show('<input name="who" placeholder="Your name">')

Ask on load, not on refusal — that is the whole reason `me()` exists.

**`private`** — members only, either way. The PAGE is part of what only they
see: a signed-out stranger asking for it is sent to the login page (303) holding
that page as its return address, and someone signed in who is nobody here gets
the same "Nothing here yet." a wrong address gets — whether the app exists at
all is its owner's to tell. The `/api/` doors answer `not_a_reader` rather than
pretending.

The app's own `worker.js` is the exception, and the only one: it runs ahead of
that bounce, so a private app with a worker is an app whose gatekeeper is its
own code. That is how a rule finer than one word gets written — an invitation
code that opens one household's row and no other. See `env.APP` in
[Code of your own](./code.md).

One rule sits above all three: **the file door is never widened.** Writing an
app's bytes is always a member's act, whatever the app lets its visitors save
into its store. An `open` app takes a guest's rows and never a guest's deploy.

## The guest list

    member_add(email, app?, name?, note?, role?, space?)
    member_remove(email, space?)

Only the space owner may invite; an editor writes the app's data and its files
but does not hand out keys.

`role` is `editor` (the default: reads and writes), `viewer` (reads only), or
`owner` (may also invite). Inviting an address that is already a member changes
their role, and the answer says what it was.

Those three words are the SPACE's roster — what `me()` answers as `role`, and
the only place `viewer` is a seat. Inside an app's own store `member` is a
different word: two seats, `owner` and `member`, saying whether someone belongs.
Belonging is not access there, so read-only is the app's `access` (`public`,
`private`) or a `grant` at `viewer`, never a seat. Write the roster with
`member_add`, not by hand.

`app` decides where the letter points. Name it and the invitation carries that
app's own link; leave it out and it carries the space's own address, which is
its front page when it has one and a list of the apps they may open when it does
not. Name the app.

`name` is what to call them — their apps show it beside what they write, so
nobody sees an address. Left out, their first sign-in asks them. It never
renames someone who has already chosen.

`note` is the inviter's own message, carried at the top of the letter, quoted
and attributed to them so nobody reads it as the platform speaking. A line or
two — 500 characters is the cap, and past it the call is refused rather than
sending half a sentence in somebody's name. Read it back to the person before
you send it: it is going out over their name.

The letter says who invited them, what they were invited to, the link, and that
signing in there with that address is all it takes — there is nothing to install
and no account to make first. They land on the page the link names.

The membership stands whatever the mail does. If the letter cannot go — the
platform's mail is misconfigured — the answer hands you the link to relay by
hand and says why. Never re-invite to "retry"; give them the link.

`member_remove` refuses to remove the last owner: a space with nobody to say who
belongs is one nobody can open again. Removing someone leaves their sign-in
intact — they lose this space, not the platform.

## Publishing

An app is a plugin. Once it is deployed you can offer it to every other space
here, and anyone can take a copy into their own.

**`app_publish(app, name?, about?, space?)`** — offer the version that is
serving now.

- The app must have been deployed. An app at v0 serves nothing an installer
  could copy, and publishing it is refused.
- `name` is the address the whole platform installs by. On a FIRST publish it
  defaults to the app's own slug. On a republish it defaults to **the name the
  offer already has** — a republish never quietly renames — and passing an
  explicit `name` moves it, which leaves the old name resolving to nothing for
  everyone who was told to install it. The answer says which of the three
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
  what the whole platform installs — and the deploy that leaves the offer
  trailing says so in its answer. `app_versions` marks which version is `(live)`
  and which is `(offered)`.

**`app_unpublish(app, space?)`** — withdraw the offer. The app is untouched,
every copy anyone took is untouched and keeps working, and the name is free
again. Refused if the app was not published.

**`app_published()`** — what is on offer, newest first. One line each:

    - tally v1 — Tally: Count the votes (from jeff/tally, installs as
      tally, published 2026-08-14)

Read it before you build something somebody may already have made.

**`app_install(name, as?, space?)`** — take one.

- `name` is the published name from `app_published`.
- The address the copy lands at is, in order: `as` if you passed it; else the
  SOURCE app's own slug, if nothing here holds that address; else the published
  name. The source's slug goes first on purpose — an app is written at its own
  address, and a copy that reads like the app is easier to reason about. (A page
  written relatively works either way; the kernel gives every page a
  `<base href>` at the app's own address.)
- An address already taken here — by an app, or by an address an app has LEFT
  and still redirects from — is refused, telling you to pass `as`.
- An installed app counts against the space's app ceiling like any other (the
  free tier allows five).
- The copy takes the published app's `access` with it: an app written to be
  voted on has to stay votable. `app_set` changes it after.
- The copy is not made the front page: `<space>.yaks.app/` lists what is here
  until somebody says which app opens there (`app_set(app, home: true)`).
- The install ends in a release of the copy: its `vocab.json` planted in ITS
  store, its `tools.json` listed under ITS slug, its `worker.js` uploaded as ITS
  own script. So the answer carries the deploy's own lines — components, tools,
  worker — under the install's.

The answer names the address, the file count, and the pin:

    installed tally v1 as ann/tally: https://ann.yaks.app/tally/ — 2 files,
    its own store and its own data, pinned to that version (app_update
    moves it)

**`app_update(app, space?)`** — move an installed copy to whatever its publisher
offers now. Below.

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
- **Members.** The copy answers the installer's space and its guest list.

## What pinning means

A copy is PINNED to the version it took. Publishing again does not move anybody:
the installer's copy keeps serving exactly what it served yesterday until
someone calls `app_update`. That is the whole point — a publisher cannot change
an app out from under the people using it, and an app someone is relying on does
not change while they sleep.

`app_published` shows the version on offer; the copy's own `app_list` line shows
the version it is at.

## What an update does

`app_update` replaces the code and keeps the data.

**Before a byte moves**, the publisher's `vocab.json` is checked against the
copy's store. A vocabulary that only GREW is applied additively. One that would
retype a column the copy's rows were written under is refused with the same
sentence a deploy gives — `vote.count is already number` — and nothing moves at
all: not the files, not the pin. The copy is exactly as it was.

Then every file of the publisher's version is written over the copy, and **every
file the copy has that the publisher does not is deleted.** That includes
anything you wrote into the copy yourself — a tweak to its stylesheet, a page
you added. What serves after is what the publisher wrote.

Then the copy is released like any deploy: components planted, tools handed
over, `worker.js` uploaded, a new version recorded, and breaks from earlier
versions closed. Then the pin moves.

What survives, always: every row they saved, every byte they uploaded, and
anything the store learned along the way. The answer says so, and says how many
files were written and how many removed.

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

The whole guide: <https://yaks.app/guide.md>
