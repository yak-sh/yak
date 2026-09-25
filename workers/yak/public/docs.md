# Building a yaks app

The platform is yaks.app, written the way its address is: lowercase, with the
`.app`. An app built on yaks.app is a yaks app.

A yaks app is an `index.html` and whatever files sit beside it, served live at
`<space>.yaks.app/<app>/`. There is no build step and no framework: what you
write is what the browser gets. Every app comes with its own store, a graph of
entities, and a small client for reading and writing it from the page.

Make one with `app_new`, write files with `app_files` (the whole set in one
call, as `files: [{path, content}, ...]`), then `app_deploy`, and give the
person the URL.

The person can also make or update one without you: the drop zone on their
space's own page accepts a `.zip` of an app's files, or a single `index.html`.

This page is the map. Each section says what a subject is and names the page
that covers it; the pages are the reference. Add `.md` to any page's address for
the markdown an assistant reads.

## The store, from a page

Every app is served a client at `./api/client.js` with six functions, all
talking to the app's own store: `apply` saves, `query` lists, `search` searches,
`subscribe` is a query that keeps calling back as rows change, `upload` saves
bytes, and `me` reports who is looking. Write every address in the app as a
relative path: the platform gives each page a `<base href>` at the app's own
address, so the same files work wherever the app is served or installed.

    import { apply, me, query, search, subscribe, upload }
      from './api/client.js'

    await apply({ entity: { eid: '$cake' },
                  doc: { title: 'Lemon cake', body: '3 lemons...' } })
    let recipes = await query('.doc!')

An entity is a bundle, `{entity: {eid}, ...components}`; a `$alias` in place of
the eid creates one. Who may read and write is the app's `access`: `public`,
`open` or `private`. Ask `me()` on load and shape the page before anyone types.

Deeper: <https://yaks.app/docs/store.md> — every function of the client, the
HTTP endpoints underneath, and who may read and write.

## Files

An `icon.png` beside `index.html` is the app's icon on a home screen. `upload`
takes a file and returns where its bytes live, addressed by their own SHA-256,
and a row that points at them is what a gallery draws. One upload is 20 MB at
most, so downscale a photo on the page before sending it.

Deeper: <https://yaks.app/docs/files.md> — the app's icon, uploads, pictures,
and a gallery that never shows one twice.

## Components

A component is a named set of properties an entity carries. The platform's own,
`doc`, `task`, `completed`, `comment`, `person`, `attachment`, `image` and the
rest, are shared by every app. An app declares components of its own in a
`vocab.json` at its root, and `app_deploy` installs them in that app's store:

    { "$defs": { "recipe": { "properties": {
        "serves":  { "type": "number" },
        "minutes": { "type": "number" } } } } }

A later deploy may add a property; one that already has rows is never dropped or
retyped. A new capability is a new component, not a new tool.

Deeper: <https://yaks.app/docs/components.md> — every component with its
properties, and vocab.json for components of your own.

## Coming back later

An app has no cron and nothing sitting awake. Any row can carry a `wake`
component naming a time and a recurrence, and the store comes back to it then,
stamping it `fired`. What a firing does is a rule declared in `vocab.json`, and
an app's own commands can be scheduled the same way.

Deeper: <https://yaks.app/docs/wakes.md> — every property, recurrence and time
zones, pausing and resuming, what a rule may match, scheduling a command, and
why there is no cron trigger to configure.

## An entity spans apps

An eid means the same entity everywhere. Two of the person's apps can each keep
their own component on one entity, with no copy and no sync between them: a
reading list keeps the `book`, a lending app keeps the `loan`. A component lives
with the app that declares it, and `graph_query` with no app named reads every
app the person has at once.

Deeper: <https://yaks.app/docs/entities.md> — which app a component lives in,
and a two-app pair end to end.

## Commands of your own

An app can carry commands of its own, so the person's agent can act on it
without a page open: a `$defs` entry of `vocab.json` marked `"tool": true`, the
way a yaks package declares its tools, with a description, an argument schema,
and one action, an `apply` template or a `query`. They are listed by `commands`
and run by `command`; they never join the connector's own tool list, which is
fixed and the same for everyone.

    "log_run": {
      "tool": true,
      "description": "Log a run for the club leaderboard",
      "input": { "who":   { "type": "string" },
                 "miles": { "type": "number" } },
      "required": ["who", "miles"],
      "apply": { "entity": { "eid": "$run" },
                 "jog": { "who": "$who", "miles": "$miles" } } }

Deeper: <https://yaks.app/docs/tools.md> — the whole reference for a command,
and the view protocol.

## The notes an app keeps

A rule the person wants followed every time goes in a `NOTES.md` beside
`index.html`: weights in grams, one photo per recipe. Any agent that can reach
the app is given it, so the rule is stated once and followed from then on.

Deeper: <https://yaks.app/docs/notes.md> — what belongs in the file, its size
limit, and the three places it is handed over.

## What the person said

The other half is the person's own words, kept for the whole space:
`memory_save` keeps a sentence verbatim with a line of context, and
`memory_recall` finds it again by what it is about. Save what they say the
moment they say how they want something built or handled.

Deeper: <https://yaks.app/docs/memory.md> — the shape of a memory, what context
is for, and how a recall is ranked.

## Code of your own

An app is pages until you give it a `worker.js`, and then it has a server. Every
request that is not `/api/...` reaches it first, and anything it answers with a
404 falls through to the files. `env.STORE` is the app's own store as the person
looking, and a secret set with `app_secret_set` arrives as `env.NAME`, which is
the reason to write a worker at all.

Deeper: <https://yaks.app/docs/code.md> — env, routes, secrets, limits, and
whole workers to copy.

## Home

The space's front page, set with `app_set(app, home: true)`, is served at the
bare address and is the space's router as well as its homepage: it sees every
path no other app claims, and can ask for paths other apps own. A router that
breaks fails open, so it never takes the space down.

Deeper: <https://yaks.app/docs/home.md> — the five steps a request goes through,
the `first` globs, why a broken router fails open, and where the space's mail
lands.

## Saving from another site

An app can take a page off somebody else's website and keep it: a worker route
that fetches the address and reads the metadata the page carries about itself,
and a bookmarklet that opens that route with the address of the page the person
is on.

Deeper: <https://yaks.app/docs/clipping.md> — the whole clipper, the
bookmarklet, and what to do when a site refuses.

## Sharing an app

Who may read and write an app is its `access` and its guest list; `member_add`
invites someone by email. A deployed app can be published under a name the whole
platform shares, and anyone can install a copy into their own space. A copy
shares nothing but the code, and stays on the version it was installed from
until its owner updates it.

Deeper: <https://yaks.app/docs/sharing.md> — access, members, publishing,
installing, pinning.

## Mail

Every app has a mailbox at `<space>.<app>@yaks.app`. Mail in both directions is
rows in the store: sending is one `apply` with the recipient, the letter and a
`deliver` request, and a letter that arrives is stored as an entity the page can
subscribe to.

Deeper: <https://yaks.app/docs/mail.md> — the bundle that sends a letter, what
comes back, how an arriving letter is stored, and the limits.

## Selling things

A seller on Plus connects a Stripe account to their space once, and after that
any app in the space posts a cart to `./api/pay/checkout` and sends the buyer to
the page it returns. A card number never reaches the app, and a paid order is
written into the app's store as an `order` row.

Deeper: <https://yaks.app/docs/selling.md> — connecting the account, the whole
shape of the checkout endpoint, what an order contains, and who can read one.

## A custom domain

A space, or one app of it, can also answer at a domain the person already owns,
with the `.yaks.app` address still working. `domain_attach` returns the one
record to add, a CNAME at the hostname pointing at `origin.saas.yaks.app`, and
`domain_status` says how far it has got. Custom domains need Plus.

Deeper: <https://yaks.app/docs/domains.md> — the record to add and where to type
it at each registrar, the apex, moving DNS to Cloudflare, and what each pending
state means.

## The filter grammar

One grammar everywhere: `.doc!` selects rows that have a component, `.doc?` asks
for one beside the rows selected, `.recipe.minutes<=30` filters a property, `&`
joins, `id=<eid>` fetches one entity whole, `limit=` windows the answer, and a
bare word is a full-text search. A row comes back with the components the filter
names, so ask for what you will draw.

Deeper: <https://yaks.app/docs/querying.md> — every operator, with worked
examples.

## When something breaks

A refusal returns a code for you and a message for the person, and `client.js`
throws the message. Every page the platform serves reports its own errors, so a
break shows up in the app's store and the person's agent hears about it once;
`app_errors` lists what is still open. Every destructive thing has a way back:
the 30-day trash, `store_restore`, file history, and `app_rollback`.

Deeper: <https://yaks.app/docs/errors.md> — every refusal, app_errors, and
rolling back.

## Who visited

Every HTML page the platform answers for an app is counted, and nothing that
could identify a visitor is kept. `app_stats` returns the visits per day, the
pages opened, the sites that linked there and the countries.

Deeper: <https://yaks.app/docs/stats.md> — what a page view records, what it
never does, and the three places to read it.

## Feedback on yaks.app itself

Anything either of you has to say about yaks.app itself, a tool that refused for
no reason you could find, a page of this documentation that taught you the wrong
thing, a wish, goes to `feedback(text, app?)`, and it reaches the people who run
yaks.app as mail they can answer. An error inside the person's own app is not
this; that is in `app_errors`, and fixing it is yours.
