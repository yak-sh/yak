---
doc:
  title: Access, Publishing and Installing
guide:
  slug: sharing
  brief: access settings, inviting people, publishing and installing an app
  description: >-
    Who may read and write an app (the public, open and private access
    settings), inviting people with member_add to one app or the whole space,
    roles, and publishing and installing: app_publish, app_install, app_update,
    the gallery, an installed copy's independent data and borrowed connections,
    how it runs like the space's own apps and the sandboxed setting, version
    pinning, and what an update does to the data people saved.
---

# Access, Publishing and Installing

This page covers two subjects. The first is who may read and write one app: its
`access` setting and its guest list. The second is how an app becomes a plugin
that anybody can install a copy of: `app_publish`, `app_install`, `app_update`,
what a copy shares, and what an update does to the data people already saved.

## Access settings

Every app has one of three access settings. `app_new(access:)` sets it when the
app is made, `app_set(access:)` changes it later, and both report what it means
in the person's own terms, so you can repeat it back to them.

**`public`** — the default. Anyone with the link reads the app and its data.
Only members write. A stranger's write is refused 401 with `not_a_writer` and a
`signIn` address that comes back to the page they were on; a signed-in viewer's
write is refused 403, because signing in would not change the answer; only the
owner can grant write access.

**`open`** — anyone with the link can also write, signed in or not. Use it for a
vote page, a guest book or a signup sheet. A visitor (anyone the app lets write
who is not its owner or an editor) can add rows, and can change or delete only
the rows they wrote; a write to anybody else's row is refused. The owner and
editors can change any row. So in a shared list that visitors tick off together,
each tick is a row of its own, written by the visitor who ticked it, rather than
an edit to somebody else's item.

A visitor cannot write three of the platform's components under any access
setting: `product` is written only by the owner and editors, an `order`'s
properties only by the platform (<https://yaks.app/docs/selling.md>), and
`deliver`, the request to send an email, only by the owner and editors
(<https://yaks.app/docs/mail.md>). A component you declare in `vocab.json` can
set the same kind of limit: `"floor": "person"` accepts writes only from someone
signed in, `"floor": "editor"` only from the owner and editors, and
`"pace": "1s"` accepts one write a second from each writer
(<https://yaks.app/docs/components.md>, "Write permissions and rate limits:
`floor` and `pace`").

An `open` app does not record who wrote a visitor's rows. A visitor who never
signed in has no identity, so their rows carry no `created.by`, and a row
without `created.by` belongs to no visitor, so no visitor can change it later.
If the page needs to show who wrote what, it has to ask for a name on the page
and save it in its own row.

    let who = await me()
    if (!who.writes) {
      show(who.signIn ? `<a href="${who.signIn}">Sign in to post</a>`
         : who.invited ? 'Accept the invitation in your email, then come back.'
         : 'Only members of this app can post.')
    } else if (!who.person) show('<input name="who" placeholder="Your name">')

Call `me()` when the page loads, not after a write is refused; that is what
`me()` is for.

**`private`** — only members can read or write. The page itself is visible only
to members: a signed-out person who requests it is redirected (303) to the login
page, with that page as the return address, and a signed-in person who is not a
member of the space gets the same "Nothing here yet." page as a wrong address,
so the answer does not reveal whether the app exists. The app's `/api/`
endpoints answer `not_a_reader` rather than a not-found answer.

Two things are served before that redirect. A file the app published is served
to anyone at its path; that is how a private app puts a page on the public web
([Files and Uploads](./files.md), "Public files: `publish`"). And the app's own
`worker.js` runs before the redirect, so in a private app with a worker, the
worker's code decides who gets in. Use it to write an access rule finer than the
three settings, such as an invitation code that opens one household's row and no
other. See `env.APP` in [Backend Code](./code.md).

Sharing an app does not have to share what each person writes in it. A component
you declare with `personal` makes each person's rows readable only by that
person, and the owner and editors cannot read them either:
<https://yaks.app/docs/components.md>, "Private per-person rows: `personal`".

One rule applies under all three settings: **only a member can write an app's
files**, whatever the app lets its visitors save into its store. An `open` app
accepts a visitor's rows, never a visitor's deploy.

## Inviting people: `member_add` and `member_remove`

    member_add(email, app?, name?, note?, role?, space?)
    member_remove(email, app?, space?)

Only the space owner may invite; an editor can write the app's data and its
files but cannot invite anyone.

`role` is `editor` (the default: reads and writes), `viewer` (reads only), or
`owner` (may also invite). Inviting an address that is already a member changes
their role, and the answer reports what it was before.

An invitation is pending until the invited person accepts it by clicking the
link in the invitation email while signed in with the address it was sent to. If
they open that link before signing in, the page shows what the email said: who
invited them to which app, and the address to sign in with. Until they accept,
they have no access to the space: it is not in their listing, a bare app name
never resolves to it, and their agent is told nothing about it. If they sign in
with that address and open the app, they are told their invitation is waiting in
the email, where anyone else would get "Nothing here yet." or a refusal; on a
`public` app, `me()` returns `invited: true` to the page, so it can tell them
before they type. Calling `member_add` again for them reports that they have not
accepted yet and sends another email. `member_remove` withdraws a pending
invitation the same way it removes a member.

In each space the caller owns, `app_list` lists every invitation not yet
accepted, with the date its latest email was sent, and counts everyone else.
When someone says they cannot get in, read this first. `app_list(app)` names
everyone who can open that app, and `app_list(people: true)` names the members
and each app's guests in every space the caller owns. The owner sees them all on
the People page of their dashboard (yaks.app/manage/people), where a waiting
invitation has a button that sends its email again.

## Inviting to one app or to the whole space

The `app` argument decides what the invited person gets access to:

**With `app`**, they become a **guest** of that one app. They open its page and
read and write its data exactly as a member does, and they have no access to the
rest of the space: its private apps answer them as a wrong address does, and its
public apps show them what anyone with the link sees. Use this for a player
joining one game, a household sharing one list, or a client seeing one project.
A guest is not on the space's member list at all, so they have no space to list
and nothing else of yours to browse.

    member_add(email: 'player@example.com', app: 'idler-rpg', role: 'editor')
    member_remove(email: 'player@example.com', app: 'idler-rpg')

**Without `app`**, they become a member of the whole space, with access to every
app in it, including every app you make later. That makes them a collaborator,
not a guest.

A guest never gets two things, whatever role the invitation gave them. The first
is the app's files: only a member can write an app's files, so an app accepts a
guest's rows and never a guest's deploy. The second is access for their agent: a
guest uses the app's pages, and their connector does not list your apps.

Inviting an existing space member to one app is refused, rather than silently
reducing their access: remove their space membership with `member_remove` first,
and then the invitation is for that one app.

The three roles come from the space's member list, and a guest's grant uses the
same three. The `role` that `me()` returns is the caller's role on the app they
are looking at: their role in the space if they are a member, otherwise their
grant on that app. Inside an app's own store, `member` is something else: it has
two roles, `owner` and `member`, and records whether someone belongs. Write both
with `member_add`, never by hand.

The `app` argument also decides the link in the invitation email. With `app`, it
links to that app; without it, it links to the space's own address, which shows
the space's front page if it has one, and otherwise a list of the apps the
person may open.

`name` is the invited person's display name: apps show it beside what they
write, so nobody sees their email address. Pass it whenever the person says who
they are inviting. Without it, the display name is the part of their address
before the `@` (`dana` from `dana@example.com`) until they change it themselves
under Settings at yaks.app/manage/settings. It never overwrites a name someone
has already chosen.

`note` is the inviter's own message, shown at the top of the email, quoted and
attributed to them so nobody reads it as a message from the platform. Keep it to
a line or two: the limit is 500 characters, and a longer note is refused rather
than sent cut off in somebody's name. Read it back to the person before you send
it, because it is sent in their name.

The email's subject is always "You have an invitation on yaks.app". The body
names who invited them and to what, and carries the accept link. Clicking it
while signed in with that address accepts the invitation and opens the page it
names; anyone else is asked to sign in with that address first, and the sign-in
returns them to accept. There is nothing to install and no account to create
first.

The accept link is sent only to the invited address, so the tool's answer never
includes it. If the email cannot be sent, the invitation still stands, and
calling `member_add` again sends it.

Each invitation email counts against the space's monthly email ceiling, and one
person may send 50 invitations an hour. Changing the role of somebody who has
already accepted sends no email and counts against nothing.

`member_remove` refuses to remove the last owner, because a space with nobody to
decide who belongs could never be opened again. Removing someone leaves their
sign-in working: they lose access to this space, not to the platform.
`member_remove(email, app)` removes access to that one app and leaves the rest.

## Publishing and installing

An app is a plugin. Once it is deployed, you can publish it, which offers that
version to every other space on yaks.app, and anyone can install a copy into
their own space.

**`app_publish(app, name?, about?, space?)`** — offer the version that is live
now.

- The app must have been deployed. An app at v0 has no files for an installer to
  copy, so publishing it is refused.
- `name` is the platform-wide name others install it by. On a first publish it
  defaults to the app's own slug. On a republish it defaults to **the name the
  offer already has**, so a republish never renames silently. Passing an
  explicit `name` renames the offer, and the old name then resolves to nothing
  for everyone who was told to install it. The answer reports which of the three
  cases happened (first publish, republish, rename), because nothing else shows
  that a rename happened.
- A name taken by somebody else's app is refused, naming the app that holds it.
  Each name belongs to one app across the whole platform.
- `about` is the one-line description someone browsing reads. Leave it out on a
  republish and the previous one stays.
- Only the **space owner** may publish. Publishing gives the code to anyone, so
  an editor cannot do it.
- **A later `app_deploy` does not change the offer.** The offer stays pinned to
  the version you published, so installers keep getting that code until you
  `app_publish` again. This is deliberate, so that an editor's deploy cannot
  change what the whole platform installs, and a deploy that leaves the offer on
  an older version says so in its answer. `app_versions` marks which version is
  `(live)` and which is `(offered)`.

**`app_unpublish(app, space?)`** — withdraw the offer. The app is unchanged,
every installed copy is unchanged and keeps working, and the name becomes
available again. Refused if the app was not published.

**`app_published()`** — lists published apps, newest first, one line each:

    - tally v1 — Tally: Count the votes (from yourname/tally, installs as
      tally, published 2026-08-14)

Read it before you build something somebody may already have made.

**`app_install(name, as?, space?)`** — install a copy of a published app.

- `name` is the published name from `app_published`.
- The copy's address is the first of these that applies: `as` if you passed it;
  else the source app's own slug, if nothing in the space holds that address;
  else the published name, adding `-2`, `-3`, and so on until free. The source's
  slug is preferred because an app is written for its own address, and a copy at
  the same address is easier to reason about. (A page written relatively works
  either way; the platform gives every page a `<base href>` pointing at its own
  folder under the app's address.)
- An explicit `as` already taken in the space — by an app, or by an address an
  app has moved away from and still redirects from — is refused. The default
  skips those addresses.
- An installed app counts against the space's app ceiling like any other (the
  free tier allows five, the Plus plan has no limit, and trashed apps do not
  count).
- The copy keeps the published app's `access` setting, so an app built for
  anyone to vote on still accepts votes. `app_set` changes it afterwards.
- The copy is not made the front page: `<space>.yaks.app/` lists the space's
  apps until somebody sets which app opens there (`app_set(app, home: true)`).
- The install finishes by releasing the copy: its `vocab.json` is installed in
  its own store, its commands are listed under its own slug, and its `worker.js`
  is uploaded as its own script. So the answer includes the deploy's lines
  (components, tools, worker) under the install's.

The answer names the address, the file count, and the pinned version:

    installed tally v1 as ann/tally: https://ann.yaks.app/tally/ — 2 files,
    its own store and its own data, pinned to that version (app_update
    moves it)

**`app_update(app, space?)`** — update an installed copy to the version its
publisher offers now. See "Updating an installed copy" below.

## The gallery

Publishing makes an app installable. The gallery, <https://yaks.app/gallery>, is
a separate public page that shows apps people have made on yaks.app. Publishing
and listing are deliberately separate: an offer is between whoever made the app
and whoever goes looking for one, while a gallery listing is yaks.app showing
somebody's app on its own page.

**`app_publish(app, gallery: true)`**, or **`app_set(app, gallery: true)`**
later, asks for a published app to be listed. Do this only when the person has
said they want it shown: the listing puts their app, their name and their
address on a public page, so never assume it. The app must be published, since a
gallery entry that cannot be installed is of no use. It also needs a screenshot:
upload one through the app's `/api/blob` endpoint and pass its returned `eid` to
`app_set(app, screenshot: '<eid>')`. This takes effect without deploying the
app. An existing `og:image` in its `index.html` works too, though a chosen
screenshot takes precedence. A selected screenshot is public while its gallery
listing is live, including for a private app; its other files and data stay
private. The screenshot can be cleared with `app_set(app, screenshot: '')` after
withdrawing a listed app.

The app is not listed immediately. The request reaches the operator at
`task@bot.yak.sh` with the app's title, address, description and maker. An admin
reviews the app and its listing, then calls
`gallery_review(app: 'space/app',
decision: 'approve', by: '<actor eid>', via: '<session eid>', reason: '…')`,
or uses the signed review link in the letter. `decision: 'decline'` clears the
request and leaves the app published. The decision records the actor in `by` and
the session in `via`.

On the operator's machine the same review is available as:

    yak admin gallery space/app approve --as admin@bot.yak.sh --reason 'Works well'

The CLI and its mirrored `admin_gallery` MCP tool take the actor and session
from the calling agent. Both use the same admin review as `gallery_review`.

The tool reports the listing's status, and so does the app's status pill on the
space's own page:

    not in the gallery
    waiting on us: it is not listed until we say yes, and a letter is on its
      way to the desk that decides
    listed in the gallery — https://yaks.app/gallery

**Removing a listing**: `app_set(app, gallery: false)` removes it immediately.
So does `app_unpublish`, because an app nobody can install is not listed. Both
clear the pending request as well as the listing, so listing the app again later
sends a new request to yaks.app.

**Deleting** the app also removes it from the gallery immediately, but in a
different way: the listing itself is not changed. A trashed app, and every app
in a trashed space, is simply not shown, and `app_restore` restores the listing
exactly as it was, without a new request.

**`gallery_search(words, limit?)`** searches the listings, matching your words
against each one's name and the line its maker wrote. It needs no account: it is
one of the few tools this connector answers when signed out. Each result
includes the `app_install` call that gives the person their own copy. Search it
before building something from scratch.

    - Tally — Count the votes
      https://yourname.yaks.app/tally/
      app_install(name: 'tally')

## What an installed copy shares

An installed copy is an ordinary app in the installer's space, with its own
address, its own store, its own file prefix, its own worker script and its own
version history starting at v1. Its store starts empty. Installation gives the
publisher no access to the copy's data, and data is not synced between them. The
publisher can also lend a connection so the copy works before its owner gets
their own key; this grants calls to the outside service, never access to either
app's store.

Only the app's own files are copied: the pages, the stylesheets, the
`vocab.json`, the `worker.js`. What is not copied:

- **Data.** Every row the publisher's copy holds stays there.
- **Uploads.** The photos a visitor sent to the publisher's copy are that app's
  data, not its code, and stay behind.
- **Version history.** The copy's history starts with the release the install
  makes.
- **Keys.** The key stays in the vault. For each connection the app uses, the
  copy either borrows the connection the publisher chose to lend (below) or asks
  for its own. An unmet request appears on the installer's connections page with
  instructions for getting the key, under the binding the app's code reads.
  Opening a connection to anyone is not copied; the installer opens their own.
  `app_update` adds any connection request the new version gained.
- **Members.** The copy belongs to the installer's space and its guest list.

## Lending a connection to installed copies

    connection_lend(app, integration, cap, space?)

Only the space owner can lend a connection their space owns and the app uses.
Set `cap` to a positive whole number of calls per month for each installed copy:

    connection_lend(app, integration: 'ESV', cap: 100)

Each copy installed afterwards borrows that connection immediately, through the
same binding the app reads. Its page or worker receives only a sentinel; the
egress replaces it with the key when calling an allowed https host. The borrower
cannot read the key, and neither space gains access to the other's app data.
Only a shared sentinel can be lent: a `direct` key, a per-person connection
(`each: true`), or a connection the app itself borrows cannot be lent.

`connection_list` reports borrowed connections, whose space lends them, and each
copy's monthly count and cap. Changing `cap` changes the cap of every copy
already borrowing through that app. Calls beyond the cap return `403` with
instructions for connecting the copy's own key.

The copy's owner can connect their own key in their own space and attach it with
`connection_attach`. That replaces the borrowed connection for their copy and
leaves the lender's connection unchanged. To stop lending to every copy and to
future installs, call:

    connection_lend(app, integration: 'ESV', cap: null)

Each borrowing copy then asks for its own connection, keeping its binding and
data. Disconnecting the lender's connection has the same effect on its copies.

The connections page does the same without an agent. On the lender's side, the
connection's Advanced options hold **Lend to copies of** the app, with the calls
a month each copy may make; saving a new number changes every copy's cap, and
**Stop lending** recalls them all. Each copy borrowing it is a row naming the
copy's space, with its calls this month against the cap and **Recall**, which
leaves that copy asking for its own. On the borrower's side, the connection
shows as borrowed from the lender's space with the copy's calls against its cap.
**Use your own key** pastes a key in its place, **Connect your own** signs in
where the service uses a sign-in, and **Use your own** attaches a connection the
space already has for that service. See
[API keys and connections](./code.md#api-keys-and-connections) for declaring a
connection and using its sentinel from a page or worker.

## How an installed app runs, and the sandbox

An installed app runs like the space's own apps. It is served at
`<space>.yaks.app/<app>/` on the space's origin, with the browser's own
`localStorage`, `sessionStorage`, IndexedDB and the sign-in cookie, and its
vocabulary is shared with the space's other apps the way theirs is. Like them,
it can read and change everything in the space the person using it can: the
space is the trust boundary.

**The sandbox.** The space's owner can isolate one installed app with
`app_set(app, sandboxed: true)`, and `sandboxed: false` removes the isolation.
Every response the app serves then carries
`Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups`, so
the browser runs it in an origin of its own. What changes:

- **Its API calls are authorized by a token, never the cookie.** The page's
  `<base href>` is `/<app>/~<token>/`, so relative paths work (`./app.js`,
  `import './api/client.js'`) and an absolute `/<app>/app.js` does not load.
- **Browser storage is provided by the platform.** `localStorage` keeps each
  signed-in person's keys in the app's store, up to a megabyte; `sessionStorage`
  lasts as long as the page. IndexedDB, `document.cookie` and service workers
  are refused, and so is the camera (and in Chrome, notifications).
- **It has no access to the rest of the space.** Another app's address treats it
  as a stranger, its `/api/files/` endpoint refuses it, and from its next
  release (`app_deploy`) its vocabulary is installed in its own store only, and
  no other app uses it.

## Version pinning

An installed copy is **pinned** to the version it installed. Publishing again
does not update any copy: the installer's copy keeps serving exactly the same
files until someone calls `app_update`. That is the purpose of pinning: a
publisher cannot change an app that people rely on, and the app does not change
unless someone in their space updates it.

`app_published` shows the version on offer; the copy's own `app_versions` shows
the version it is at.

## Updating an installed copy

`app_update` replaces the code and keeps the data.

**Before any file is written**, the publisher's `vocab.json` is checked against
the copy's store. A vocabulary that only grew is applied additively. One that
would retype a property the copy's rows were written under is refused with the
same message a deploy gives, `vote.count is already number`, and nothing
changes: neither the files nor the pinned version. The copy stays exactly as it
was.

Then every file of the publisher's version is written over the copy, and **every
file the copy has that the publisher does not is deleted.** That includes
anything you wrote into the copy yourself — a tweak to its stylesheet, a page
you added. After the update, the copy serves exactly the publisher's files.

Then the copy is released like any deploy: components installed, commands
registered, `worker.js` uploaded, a new version recorded, and errors from
earlier versions closed. Then the pinned version moves to the new one.

An update always keeps every row they saved, every file they uploaded, and
everything else the store holds. The answer confirms that, and reports how many
files were written and how many removed.

Three cases where `app_update` does not update:

- The app was not installed from anywhere — it is their own app, and
  `app_deploy` releases what you write in it.
- The app it came from is no longer published — the copy keeps working, data and
  all, and there is nothing to update it to.
- It is already at that version — answered, not refused: "nothing to update".

## Installing instead of building

`app_published()` is one call and costs nothing. When the person asks for
something common, such as a vote page, a chore chart or a signup sheet, check it
first. Installing takes a second and gives them their own copy with their own
data, and you can change their copy afterwards with `app_files`. An install
costs only one of the space's app slots.

---

The whole guide: <https://yaks.app/docs.md>
