// GENERATED — do not edit. The words live in the files:
// public/guide/*.md (a page's frontmatter), prompts/*.md (a prompt's), and
// tools.yml (what each tool says about itself). Change one of those and run
// `deno task content`; `deno task content --check` refuses this file when it
// has fallen behind (gen.ts, T-34606).
//
// A Worker has no filesystem, so this is how words written in files reach an
// isolate: as a module it imports like any other. The types are the
// hand-written ones this stands in for, imported for their shape alone.
import type { Page } from './guide.ts'
import type { Said } from './prompts.ts'
import type { Words } from './tool.ts'

/** Every guide page's row, by slug. */
export let PAGES: Record<string, Page> = {
  'clipping': {
    'slug': 'clipping',
    'title': 'Saving from another site',
    'description':
      "Clipping a page somebody is reading into the app's store: a worker route that fetches it and reads its JSON-LD, Open Graph and title, a bookmarklet that launches it, why a script on another site cannot write here, and what to say when a site refuses a robot.",
    'brief': 'saving a page from another site',
  },
  'code': {
    'slug': 'code',
    'title': 'Code of your own',
    'description':
      "worker.js in front of an app's files: which routes are yours, what env holds (STORE, FILES, and the secrets you set), what a request says about who is asking, the CPU and subrequest limits, and whole workers to copy.",
    'brief': "worker.js in front of an app's files",
  },
  'components': {
    'slug': 'components',
    'title': "Components: the platform's, and your own",
    'description':
      'Every component an app already has, column by column, and vocab.json for words of your own: the column types, what a later deploy may change, the names already taken, and when a column beats doc.body.',
    'brief': "the platform's words, and your own",
  },
  'domains': {
    'slug': 'domains',
    'title': 'A domain of their own',
    'description':
      'Pointing a domain the person already owns at their space or at one app of it: the CNAME to add and where to type it at GoDaddy, Namecheap, Squarespace and the rest, the apex problem and the three ways through it, what each pending state means, and why a domain stays stuck.',
    'brief': 'pointing a domain at a space or an app',
  },
  'entities': {
    'slug': 'entities',
    'title': 'One entity, two apps',
    'description':
      "Two of the person's apps writing about the same entity without copying it: which app a component lives in, how a page reads a sibling app, and how graph_query composes one bundle out of several.",
    'brief': 'one entity across two apps',
  },
  'errors': {
    'slug': 'errors',
    'title': 'When something breaks',
    'description':
      'What a refused call answers and how a page shows it, where a break is filed and how the agent hears about it once, app_errors, app_versions and app_rollback, the 30-day trash app_delete and space_delete put a thing in and app_restore and space_restore take it out of, and feedback for anything you or the person have to say about the platform itself.',
    'brief': 'what broke, and rolling back',
  },
  'files': {
    'slug': 'files',
    'title': 'Files and pictures',
    'description':
      "app_files for the app's own files — what a write answers, the patch and fetch ops, the history every write keeps and the restore that puts one back, the icon.png that gives an app an icon on a home screen — then upload() for a file off an <input>: where the bytes are served back from, the attachment and image rows it writes, the 20 MB ceiling and the downscale under it, and a gallery that never shows one picture twice.",
    'brief': "the app's files, its icon, uploads, pictures",
  },
  'home': {
    'slug': 'home',
    'title': 'The front page, and routing the space',
    'description':
      "The app served at <space>.yaks.app/ and how it routes the space: the five rungs a request is answered in, app_set home, the first globs that send another app's paths to it, why a broken router fails open, and where the space's own mail lands.",
    'brief': 'the front page, and routing a space',
  },
  'mail': {
    'slug': 'mail',
    'title': "Mail: an app's own address",
    'description':
      'Sending and receiving email from an app: the address a space and an app make, the bundle that sends a letter and who may ask for one, the delivered and bounced rows that come back, how an arrival lands with its attachments, and what mail here does not do.',
    'brief': "an app's own email address",
  },
  'memory': {
    'slug': 'memory',
    'title': 'What the person said',
    'description':
      'memory_save and memory_recall: keeping what the person said about how they want things done, in their own words rather than your summary of them — what belongs in a memory, what context is for and what it is not, when to reach for each tool, how a recall is ranked, and how a memory differs from the notes an app keeps.',
    'brief': 'the words a person wants remembered',
  },
  'notes': {
    'slug': 'notes',
    'title': 'The notes an app keeps',
    'description':
      "NOTES.md beside index.html, where an app keeps what its person wants written down about how it is kept — where the file goes, what belongs in it and what does not, the size ceiling, how about and the prompt of the app's own name hand it over, and what an installed copy carries.",
    'brief': 'the notes an app keeps',
  },
  'querying': {
    'slug': 'querying',
    'title': 'Querying: the filter line',
    'description':
      'The filter grammar every door here speaks, with worked examples: presence and absence, contains, comparisons, ranges, time phrases, walking a reference, counting, paging, full text — and why a row carries only the components its filter named.',
    'brief': 'the filter line, with examples',
  },
  'selling': {
    'slug': 'selling',
    'title': 'Selling things',
    'description':
      "Taking money for something: how a seller connects their own Stripe account to a space, the ./api/pay/checkout door a page posts a cart to and what it answers, why a page never posts a price, the order row and the buyer's letter that land when the money moves, who can read an order afterwards, and why a card number never reaches your app.",
    'brief': 'taking money for something an app sells',
  },
  'sharing': {
    'slug': 'sharing',
    'title': 'Publishing and installing an app',
    'description':
      'Who may read and write an app, and how one travels: app_publish, app_install and app_update, what an installed copy shares (the code, and nothing else), what pinning means, and what an update does to what people saved.',
    'brief': 'publishing and installing an app',
  },
  'stats': {
    'slug': 'stats',
    'title': 'Who visited',
    'description':
      "Visitor counts for an app: what one page view records and the six things it never does — no address, no visitor id, not even the browser's own string — app_stats and the window it takes, the block on their space page, the door a page reads its own numbers at, and why a small number is usually crawlers.",
    'brief': 'who opened an app, and from where',
  },
  'store': {
    'slug': 'store',
    'title': 'The store, from a page',
    'description':
      './api/client.js in full — apply, query, search, subscribe, upload and me — the shape of an entity bundle, patching and deleting, who may read and write, the byline on a row, seed.json for the data an app comes with, and the HTTP doors underneath.',
    'brief': 'reading and writing from a page',
  },
  'tools': {
    'slug': 'tools',
    'title': 'Commands of your own',
    'description':
      "tools.json, so the person's agent can act on an app with no page open: an entry's description, its input types and {{arg}} holes, the apply and query acts, what a deploy refuses, the view an answer draws itself in, and how commands and command carry them.",
    'brief': 'commands of the app, for an agent',
  },
}

/** Every prompt this door offers, by name. */
export let SAYS: Record<string, Said> = {
  'app-ideas': {
    'name': 'app-ideas',
    'title': 'Ideas for what to make',
    'description':
      'A handful of apps worth making on yaks.app for this particular person — out of what they have said and what they have already made — each a line or two, with an offer to build one.',
    'arguments': [],
    'body':
      "Any yaks.app ideas you think I'd like, based on our chat history?\n\nWhat gets made there: an app is an index.html and whatever files sit beside it,\nserved live at an address of my own — it opens on my phone, it keeps what it\nsaves in a store of its own rather than in one browser, and it is a link I can\nsend to somebody. It can be mine alone, readable by anyone with the link, or\nopen for anyone to add to, and I can invite people into it by email address. It\ncan carry commands of its own for you to call, keep what I have told it about\nhow I want things done, and take money through Stripe. Read the guide before you\ndecide what is possible — the guide tool, or https://yaks.app/guide.md.\n\n{{having}}\n\nGive me five or so, each a line or two: what it is, and why me. Tie every one to\nsomething I have actually said or done rather than to apps in general. Then\noffer to build whichever I pick.",
  },
  'fix': {
    'name': 'fix',
    'title': 'Fix what is broken',
    'description':
      "Find what has broken in the person's apps — the breaks nobody has looked at yet — fix it, and deploy the fix.",
    'arguments': [
      {
        'name': 'app',
        'or': 'my apps',
        'description':
          'The app to look at, by its slug. Leave it out for everything they have.',
      },
    ],
    'body':
      'Something is broken in {{app}} on yaks.app. Find out what — start with\napp_errors, and read the breaks nobody has looked at yet — then fix it and\ndeploy the fix. Tell me what was wrong in one line, and say so plainly if the\nfix is something only I can do.',
  },
  'make': {
    'name': 'make',
    'title': 'Make something new',
    'description':
      'Build what the person asks for as an app on yaks.app — its own address, its own store — and hand them the link.',
    'arguments': [
      {
        'name': 'what',
        'description':
          'What they want: "somewhere to keep recipes", "a chore board for the house", "a page where my friends vote on a date".',
        'required': true,
      },
    ],
    'body':
      "Make me something on yaks.app: {{what}}\n\nBuild it as an app there — its own address, its own store — and give me the link\nonce it works. Keep whatever it saves in the app's own store, so it is the same\non my phone. If other people are meant to use it, or it needs to be more than\none page, ask me before you deploy.",
  },
  'publish': {
    'name': 'publish',
    'title': 'Publish an app for anyone here',
    'description':
      'Offer an app to every other space on the platform under a shared name, so somebody can install a copy of their own.',
    'arguments': [
      {
        'name': 'app',
        'or': 'one of my apps',
        'description': 'The app to publish, by its slug.',
      },
      {
        'name': 'about',
        'or': '',
        'description': 'The line someone browsing reads, if they have one.',
      },
    ],
    'body':
      'Publish {{app}} on yaks.app so anyone here can install their own copy.{{about}}\n\nBefore you do: tell me what a copy carries and what it does not, and check the\nversion that is serving now is the one I want other people taking. Then pick the\nname it installs under and publish it.',
  },
  'share': {
    'name': 'share',
    'title': 'Share an app with someone',
    'description':
      'Let a particular person into an app: settle its access, invite them by email address, and hand back the link to send.',
    'arguments': [
      {
        'name': 'app',
        'or': 'one of my apps',
        'description': 'The app to share, by its slug.',
      },
      {
        'name': 'who',
        'or': 'someone',
        'description': "The person's email address.",
      },
    ],
    'body':
      'I want to share {{app}} on yaks.app with {{who}}.\n\nWork out what its access should be first — whether they have to sign in, and\nwhether anyone else with the link could write — and tell me what you picked.\nThen invite them and give me the link to send.',
  },
}

/** What every tool says about itself, by name. */
export let WORDS: Record<string, Words> = {
  'space_new': {
    'title': 'A new space',
    'description':
      'Another corner of yaks.app, at <slug>.yaks.app, with the person as its owner. They already have one from signing in, and every other tool uses it without being told — so this is only for a second address.',
  },
  'space_delete': {
    'title': 'Close a space',
    'description':
      "Close a space: it goes to the trash for 30 days. Every app in it stops answering, its address stops serving and its apps leave your tools — but nothing is erased, the address is held, and space_restore brings the whole space back within those 30 days. After that the platform erases it: the apps, everything they saved, their files, any domain aimed at them, and the address goes back into circulation. YOU CANNOT DO THIS: it mails the space's owner a link that does it, lasting an hour, and answers with what that link would stop. Read that back to them and tell them to check their email — it is theirs to confirm, not yours. Only the owner of the space may ask, and app_delete is the smaller thing when they mean one app. Pass forever: true and the link erases it there and then instead, with nothing kept and no undo — only when the person has said they mean exactly that. The way back: space_restore, any time in those 30 days.",
  },
  'space_restore': {
    'title': 'Take a space out of the trash',
    'description':
      "Bring back a space that was deleted. Every app in it serves again at the address it always had, their tools and pages come back, and everything they saved is exactly as it was — nothing was touched while it sat in the trash. Within 30 days of the delete being confirmed; after that the space has been erased and there is nothing to bring back. Unlike space_delete this is the assistant's to do: putting a space back is not an act anybody needs protecting from.",
  },
  'space_sell': {
    'title': 'Start selling',
    'description':
      "Connect this space to Stripe so its apps can take money. The person gets a link to finish setting up with Stripe — their name, their bank account, whatever Stripe asks — and that all happens at Stripe, not here: we never see or hold any of it. They are the merchant. It is their charge, their money, their name on the customer's statement, and refunds and disputes are theirs to answer. HAND THEM THE LINK AND STOP: nobody can sell until they have finished it, and calling again gives a fresh link onto the same Stripe account, never a second one. Once they are done, every app in the space can take payments through POST /api/pay/checkout — see the selling guide. Pass disconnect: true to stop selling here; their Stripe account and everything in it stays theirs, this space just stops charging on it.",
  },
  'app_new': {
    'title': 'A new app',
    'description':
      "Start a new app — the thing you are making for the person. It lives at <space>.yaks.app/<slug>/ and the first app in a space also answers the bare address. Then app_files to write index.html, app_deploy to release, and give them the link. Pass access when the app is for other people too: 'open' if anyone with the link should be able to act on it — vote, add a line, sign up — and 'private' if only they and whoever they invite (member_add) should see it at all.",
  },
  'app_files': {
    'title': "The app's files",
    'description':
      "Write the app's files — index.html and any css, js or images beside it — or list them, read one back, or delete one. Write a whole app in ONE call with files: [{path, content}, …] — a files batch IS the write, so leave op out; path and content write a single file, and base64 in place of content writes one that is not text — a picture, or the .wasm a worker.js imports. They serve live at <space>.yaks.app/<app>/<path>; index.html answers the directory. Keep what the app remembers in its own store, never localStorage: the page reads and writes it with `import { apply, query, search } from './api/client.js'`, which is served beside the app. Write every address relative: the kernel gives each page a `<base>` at the app's own address, so nothing in an app names the app, and a copy someone installs at another address still works. Every write answers what it stored — the byte count and the sha256, and for a .json file whether it parses, naming the position when it does not — so a miscounted bracket is caught in the call that made it. NOTES.md beside index.html holds the app's own notes — how this one is kept, in the person's words, up to 4 KB — and the about tool hands them back. It is the app's inside, like vocab.json: never served on the web, read back here. op: patch with path, find and replace edits one file in place: find is exact and must match exactly once. op: fetch with path and url writes an https response body to path, which is how a library is vendored without transcribing it, and answers an integrity hash for it. Nothing a write or a delete takes away is lost: each keeps the bytes it replaced for 30 days, op: history with path lists them newest first — sha256, size, when it was replaced and by whom — and op: restore with path puts one back, the newest by default or the one sha or at names. A restore is itself a write, so it too can be undone. Call guide for the whole of it, in a page (https://yaks.app/guide.md). The way back from any write, patch, fetch or delete here: op: history, then op: restore.",
  },
  'sandbox_exec': {
    'title': 'Run a build command',
    'description':
      "Run one command in this space's build sandbox — a Linux container for the things a browser cannot do for itself: compile something to WebAssembly, run a generator, minify an asset. Installed: Rust 1.98.1 with the wasm32-unknown-unknown target, wasm-bindgen 0.2.128 and wasm-opt 132; Python 3.13.15 with pip; Go 1.27.1; Zig 0.16.0, which is also the C and C++ compiler here — `zig cc -target wasm32-freestanding -nostdlib -Wl,--no-entry` gives a module a browser loads with no glue, and -target wasm32-wasi one a WASI shim runs; Deno 2.9.1, and the Node and Bun the base image ships. Anything else installs FOR THE SESSION: the command runs as root, so `apt-get install -y <pkg>` or a download works, and it costs the next build nothing. Write the source with sandbox_write, build it here, then sandbox_ship the artifact into the app. An app needs none of this — html, css and js run as they are, so reach for the sandbox only when something must be COMPILED. It is signed in as the person: `yak` is installed and $YAKS_TOKEN and $YAKS_HOST are set, so `yak <tool>` and curl reach these same tools from inside a script, and the token dies with the container. The container is metered: every second it is awake is charged to the space, and one build gets {{budget}} of them, so plan the build and run it once rather than poking at it. It is destroyed when the build ends, and everything in it with it. The way back: none is needed — nothing of the app is here. The container is a throwaway machine, and only sandbox_ship moves anything out of it.",
  },
  'sandbox_write': {
    'title': 'Write a build file',
    'description':
      "Write one file inside this space's build sandbox — a Cargo.toml, a src/lib.rs, whatever the build needs. These are NOT the app's files: nothing here is served, and everything here is gone when the build ends. app_files writes what the app serves; sandbox_ship moves a built artifact from here to there. Waking the sandbox is metered by the second, like sandbox_exec. The way back: none is needed — nothing of the app is here. The container is a throwaway machine, and only sandbox_ship moves anything out of it.",
  },
  'sandbox_read': {
    'title': 'Read a build file',
    'description':
      "Read one file back out of this space's build sandbox — a generated source, a build log, whatever the last command left behind. Waking the sandbox is metered by the second, like sandbox_exec.",
  },
  'sandbox_ship': {
    'title': 'Ship a build artifact',
    'description':
      'Copy what the build made into the app, where it is served: name the files in the sandbox — pkg/*.wasm, pkg/*.js — and each lands beside index.html under its own name, as if app_files had written it. This is the last step of a compile: the sandbox is thrown away and the app keeps the artifact. Bytes are carried as bytes, so a .wasm arrives whole. Waking the sandbox is metered by the second, like sandbox_exec. The way back: these land through app_files, so each keeps the bytes it replaced — app_files op: history, then op: restore.',
  },
  'app_deploy': {
    'title': 'Release a version',
    'description':
      "Release what you have written: the files are already live, so this is the mark that they are one version — the one an error will name. Do it when the app is ready to show, then give the person the URL. It also plants the components the app's vocab.json declares — {{vocab}} — so the app gets typed components of its own. A word the platform already says is refused, the whole manifest at once and before anything is planted; one this manifest stops naming, and that holds no rows, goes. It answers the columns it ADDED and the ones the store still has that this manifest did not name — a column is never renamed or retyped, so a new spelling arrives beside the old one, which keeps every row already written under it. A seed.json beside index.html — a list of bundles, or a seed/ folder of *.json files when there is a lot of them — is written into the app's store here, once per store and after the components, so the app opens with data in it; deploy again and nothing is seeded. A tools.json beside it gives the app commands of its own — {{tools}} — which everyone who can reach the app runs with the command tool, so the person and their agent act on the app through its own words. And a worker.js beside index.html becomes the app's own server code: it answers every request that is not /api/ before the files do, and whatever it answers 404 falls through to them. Every deploy is kept, so app_rollback can put this one back later. If the app is published, the offer does NOT move with it — what strangers install stays the version you published until you app_publish again, and this says so when it starts trailing. The way back: app_rollback, which puts an earlier deploy back as a new version.",
  },
  'store_load': {
    'title': 'Load a data file into the store',
    'description':
      'Write a data file the app already carries into the app\'s store, now. path is one file — data/cities.json — or a folder, and then every *.json and *.csv under it goes in. A JSON file holds the same list of bundles a seed.json does and graph_apply takes: [{"entity": {"eid": "$a"}, "doc": {"title": "…"}}]. A CSV is a spreadsheet, and `as` names the component ONE ROW becomes — as: "city" with headers name,country writes city{name, country} per row, values coerced to the column types the vocabulary declares; `title` and `body` land in the row\'s doc, an `id` (or `alias`) column is the row\'s NAME — alias{name}, which lands on the entity already holding it, so loading the file again patches those rows instead of duplicating them and the name stands wherever an eid does, and map {"Serves how many": "serves"} renames a header that does not match a column. A header naming nothing is refused, as is a cell that will not coerce, both naming the row and the header. Together the files are ONE batch, read in filename order, so an alias minted in one file resolves in the next; if the store refuses a bundle nothing is written and the refusal names the file and the entry that caused it. This is how a big dataset arrives without being typed into a call: app_files(op: fetch) writes the https body into the app, store_load puts it in the store — two calls. Unlike a seed it is not once-only: call it whenever, and it patches and adds as the caller, so the rows carry your byline. It applies whatever the file says, deletes included — a bundle with $delete: true (or tombstone: {}) deletes that entity, and the store is the judge of whether you may. A bundle naming an eid patches that row; one naming a $alias mints a new entity each run — unless it carries alias: {name: "…"}, which lands on the entity already holding that name, so a file loaded twice is a patch and not a second copy.',
  },
  'app_versions': {
    'title': 'Deploy history',
    'description':
      'Every deploy of the app, newest first, with when it went out and what changed in it. Read it when the person says the app used to work, or before putting it back, so you name the version they mean. The app keeps its last 20.',
  },
  'app_rollback': {
    'title': 'Roll back a release',
    'description':
      'Put the app back the way it was — every file of an earlier deploy, its components, its tools and its own code with them. This is the answer when the person says a change broke something or asks for it back; you do not need to remember what you wrote. It goes out as a NEW version, so nothing is lost and a rollback can itself be rolled back. Leave version out for the deploy before the live one, or name one off app_versions. Give the person the URL and tell them what came back. Their data is never touched — only the files. The way back: another app_rollback, since this goes out as a new version and app_versions still lists the one you left.',
  },
  'store_restore': {
    'title': 'Put a store back to a moment',
    'description':
      "Put everything the app has saved back to how it was at a moment — the whole store, every row of it, as of that time. This is the answer when a write went wrong and the person wants their data back: a bad import, rows deleted that should not have been, a change that turned out to be the wrong one. Cloudflare keeps the last 30 days of the store, so any moment in those 30 days can be asked for; at is that moment, as a time (2026-09-06T14:20:00Z). Call it with no at first: it says the oldest moment still available and every restore already made. It is REVERSIBLE — where the store stood before is written down before anything moves, so a restore is undone by restoring again to a moment just before it, and the answer hands you that exact sentence. What it costs is what was written since the moment asked for, so name the moment as late as it can be. The app is briefly restarted to pick the recovery up. The app's FILES are not part of this — app_rollback and app_files restore put those back. The way back: another store_restore, to the moment just before this one, which the answer hands you.",
  },
  'app_set': {
    'title': 'Rename or reshare an app',
    'description':
      "Rename an app, change its title, or change who may use it. The title is what it is called; the slug is its address, so changing it moves the app to <space>.yaks.app/<new>/ — its files and everything it has saved come with it, and the old address redirects to the new one, so a link someone already has still works. Give the person the new link. access is the same choice app_new takes: set it to 'open' when they want everyone with the link to be able to act on the app, 'private' to shut it to everyone but its members. home makes this app the space's front page — what <space>.yaks.app/ opens, the app someone lands on when they are given the space itself. The first app made in a space is it until someone says otherwise, so set it when the app they care about was not the first one; home false leaves the space with no front page. Only the space owner may move it. first is the front page's own routing: the paths its worker.js answers BEFORE the app whose name owns them, as globs — [\"/recipes/*\"] sends every address under /recipes/ to the front page instead of the recipes app. Leave it alone unless the front page is meant to route the whole space; an empty list puts every path back where it was. gallery is whether a published app is put forward for https://yaks.app/gallery, the public page of apps made here: true asks, false takes it back at once. Only when the person has said which they want.",
  },
  'app_secret_set': {
    'title': 'Set a worker key',
    'description':
      "Give the app's worker a key for an outside service — an API key, a token — without the page ever holding it. The value goes onto the app's own script and NOWHERE else: it is not saved in the app's data, not in its history, and no tool, this one included, can ever read it back. Only the worker can, as env.NAME, so name it the way its code will spell it: app_secret_set(app, name: 'WEATHER_KEY', value) and then `fetch(url, {headers: {authorization: env.WEATHER_KEY}})` in worker.js. Ask the person for the value; never invent one. Setting a name that is already there replaces it. The app needs a worker.js (app_deploy uploads it) for the secret to reach any code.",
  },
  'app_secret_list': {
    'title': 'The worker keys',
    'description':
      "The names of the keys the app's worker can read. Values are never answered — by this tool or any other. Use it to see what a worker.js may spell as env.NAME.",
  },
  'app_secret_remove': {
    'title': 'Remove a worker key',
    'description':
      "Take a key away from the app's worker. Its code stops seeing env.NAME at the next request; nothing else about the app changes. The way back: app_secret_set with the value again — a secret is never readable once set, so this is the one thing here nothing can restore for you.",
  },
  'app_delete': {
    'title': 'Throw an app away',
    'description':
      'Throw an app away: it goes to the trash for 30 days. Its address stops answering, its tools and pages leave you, and it stops being the front page — but its files, everything it saved and its slug are all kept, and app_restore brings the whole app back within those 30 days. After that the platform erases it for good. Only when the person asks for the app to be deleted; app_files delete removes one file, and app_set moves an app rather than replacing it. Pass forever: true to skip the trash and erase it now — for the person who means it, since nothing is kept and there is no undo. The way back: app_restore, any time in those 30 days.',
  },
  'app_restore': {
    'title': 'Take an app out of the trash',
    'description':
      'Bring back an app that was deleted. It serves again at the address it always had, its tools and pages come back, and everything it saved is exactly as it was — nothing was touched while it sat in the trash. Within 30 days of app_delete; after that it has been erased and there is nothing to bring back. app_list shows what is in the trash and how long each has left.',
  },
  'app_errors': {
    'title': 'What is broken',
    'description':
      "Everything still broken in the app: what a page threw in someone's browser, what a request threw on the way, and what the platform reported. Each is an entity in the app store. New ones also ride the end of your next reply, once. Pass `fixed` with the ids you have fixed and they are archived, which is what stops them showing here and there; pass `seen` to say the same about breaks you are done with without listing every id — `all`, `v3` for everything up to and including that deploy, or a day. It draws itself where the person can see it, with the same button on each break.",
  },
  'app_list': {
    'title': 'Every app they have',
    'description':
      "What the person already has here: every app in every space of theirs, with its address, the mailbox it sends and receives at, the version it is at, how many breaks are still open in it, which one is the space's front page, and what the month has cost against what the space is allowed. Read it before making a second app, and when they ask what they have or where something lives. Anything deleted is listed under Trash with the days it has left, until app_restore brings it back or the 30 days run out.",
  },
  'commands': {
    'title': 'What the apps can do',
    'description':
      "The commands the apps here declare, with the arguments each one takes. An app's own verbs — the ones its tools.json spells and the two every word it holds is worth, like add_recipe and find_recipe — live here rather than in this tool list, which is the same for everybody. Read it when an ask sounds like something an app of theirs already does, then run one with command.",
  },
  'command': {
    'title': 'Run an app command',
    'description':
      "One of an app's own commands, run: name it and pass its arguments as args, exactly as commands says it takes them. The app is only needed when two apps here spell the same command. It goes through the app's ordinary doors as the person calling it, so it can do what they could do on the page and never more. The way back: store_restore, to the moment just before it ran, for whatever it wrote.",
  },
  'domain_attach': {
    'title': 'Attach a domain',
    'description':
      "Serve a domain the person already owns — herbusiness.com instead of jeff.yaks.app. Name an app and that app answers at the root of the domain; leave app out and the whole SPACE answers there, exactly as it does at <space>.yaks.app — the front page at /, every app at /<app>/. A space and its apps can each have their own domain at once. It provisions the hostname here and answers with the DNS record they have to add where their domain is managed, as data: type, name, value. Add it for them if you can reach their registrar; otherwise walk them through their own panel — you know what GoDaddy's and Namecheap's look like. Nothing serves until that record is in place, so tell them the record and then domain_status to watch it come up. Only the space owner may attach one.",
  },
  'domain_status': {
    'title': 'Domain progress',
    'description':
      'How far a domain has come, and what it points at — the space, or one app of it. Whether the DNS record has arrived, whether Cloudflare has accepted the hostname, and whether the certificate is issued — each said specifically enough to tell the person what is still waiting on them. Read from Cloudflare, not from what we last wrote down. Leave hostname out for every domain in the space. Call it after domain_attach, and again a few minutes later; nothing needs doing between.',
  },
  'domain_detach': {
    'title': 'Detach a domain',
    'description':
      "Stop serving at a domain, whether it carried a space or one app. The hostname is given back to Cloudflare and what it served is untouched — it still answers at its <space>.yaks.app address, and its data and files are not involved. The person's DNS record is theirs to remove wherever their domain is managed; until they do it points at nothing. Only the space owner may. The way back: domain_attach with the same hostname, which starts the certificate again.",
  },
  'app_publish': {
    'title': 'Offer the app to others',
    'description':
      "Offer this app to every other space, by name. Someone else then app_installs it and gets their OWN copy — their own store, their own address, their own data from the first byte — pinned to the version you published; nothing is shared but the code. The name is the whole platform's, so it is the app's slug unless that is taken, and a taken name is refused. Publishing again offers whatever is deployed now under the name it already has — a name is claimed once, and only an explicit name moves it, which leaves the old one resolving to nothing; nobody who installed it moves until they app_update. Only the space owner may publish, and only what the person asked to share. gallery: true also puts it forward to be SHOWN on https://yaks.app/gallery — a public page of what people have made. That is a separate thing from publishing and only ever the person's own choice: ask them, never assume it. It is not listed on the spot — yaks.app reads the ask and answers, and the app is on offer either way.",
  },
  'app_unpublish': {
    'title': 'Stop offering the app',
    'description':
      'Stop offering the app. It stays exactly as it is and so does every copy anyone installed — their data is theirs — but nobody new can install it, and the name is free again. It leaves the gallery at the same moment, if it was on it. Only the space owner may. The way back: app_publish, which offers it again under the same name unless somebody else has taken it meanwhile.',
  },
  'app_published': {
    'title': 'Published apps',
    'description':
      'What other people have published here, newest first: the name to install by, what it is, and which space it came from. Read it when the person asks for something somebody may already have made — installing one is app_install, and gives them their own copy with their own data. With words, only the offers whose name, title or description say them. It needs no account: a published app is offered to everybody, and its own pages are readable at the address printed here.',
  },
  'app_install': {
    'title': 'Install a published app',
    'description':
      "Take an app somebody published (app_published lists them) and give the person their OWN copy of it: their own address, their own data store, their own everything from the first byte. Nothing is shared but the code, so what they save is theirs alone and the publisher never sees it. The copy is PINNED to the version it took — the publisher's next version does not arrive behind them; app_update moves it, keeping their data. Then give them the link.",
  },
  'app_update': {
    'title': 'Update an installed app',
    'description':
      "Move an installed app to whatever version its publisher offers now. The person's data stays — every row they saved is theirs and is not touched — and only the code is replaced, so anything you wrote into the copy yourself is replaced too. A vocabulary that only grew is applied to their store; one that would retype a column their rows were written under is refused, and nothing moves. It answers what changed. The way back: app_rollback, since the update goes out as a version like any other and app_versions lists the one before it.",
  },
  'member_add': {
    'title': 'Invite someone',
    'description':
      "Invite someone into the space by email address, so they can change what its apps hold: an editor writes, a viewer only reads, an owner may also invite. The invitation is MAILED to them — who invited them, the link, and that signing in at it with that address is all it takes — so name the app they are being invited to and the letter points at it instead of the space. Pass a note and the person's own message goes at the top of that letter, as written and quoted as theirs: a line or two saying what this is (\"the potluck list for Saturday\"), which is the difference between an invitation someone opens and one they wonder about. Pass their name if you know it and their apps will show it beside what they write, so nobody sees an address; they can say for themselves at their first sign-in. There is nothing for them to install and no account to make first. Only the space owner may invite. For an app that everyone with the link should be able to act on without signing in at all, give it access 'open' instead (app_set).",
  },
  'member_remove': {
    'title': 'Remove someone',
    'description':
      'Take someone back out of the space: they keep their sign-in and lose this space. Only the space owner may, and the last owner cannot be removed — a space with nobody to say who belongs is one nobody can ever open again. The way back: member_add with the same address, which puts them back where they were.',
  },
  'grant': {
    'title': 'A token for the CLI',
    'description':
      'A short-lived token that signs the `yak` CLI in as this person — the same identity and exactly the same access they have here, never more. Reach for it when someone wants to work from their own terminal, or wants a script to reach their apps: the answer is the one line they paste. It lasts an hour unless `hours` says otherwise (24 at most), and `space` narrows it to one space, which is what to do when it is going somewhere less careful than a laptop. Show them the answer as it is: the token is said ONCE and kept nowhere it can be read back. `revoke` takes one back before it expires, by the id the minting answer named.',
  },
  'feedback': {
    'title': 'Send feedback',
    'description':
      "The door for ALL feedback about yaks.app itself — this connector, its tools, its guide, the way an app is built or served here. A bug, a rough edge, a step that took three tries, a confusing answer, a wish, a feature idea, a thing that went well: all of it is wanted, from what YOU ran into working here or in the PERSON's own words. Not the app you are building for the person: a break inside their own app is theirs and yours to fix (app_errors lists those). Reach for this the moment it comes up — a tool that refused for no reason you could find, a door that does not exist, an answer that disagreed with what was documented, a step the person found baffling, something they wished this place did, a sentence they said about any of it. Where something is broken, go on and work around it: nobody sees the workaround, and this is what they see instead. Say what the PERSON said, in their own words, and what YOU tried and what happened — those two are the whole report. Who they are, their space, the app if you name one, and the versions ride along on their own; do not repeat them. It reaches a person by mail, and they can write back. It works signed out too — the report then says it came from someone signed out, and there is no address to answer, so put one in the words if a reply is wanted.",
  },
  'guide': {
    'title': 'The guide',
    'description':
      'The guide, read here instead of fetched off the web. With no page: the map — what an app is, how its pages read and write its store, and a passage on every feature there is. Read that first. With a page: the whole of one subject. The pages are {{pages}}. A name that is none of them answers the map, which lists them all. The same words are served to a person at https://yaks.app/guide.md.',
  },
  'about': {
    'title': 'What yaks.app is',
    'description':
      'What yaks.app is and what gets made here. Call it when someone asks what this place is, or when you have not signed in and want to know what works signed out and what signing in would add — it answers in a paragraph and says where to sign in. Signed in, it also says WHO you are signed in as, how (a browser, a connector, a CLI grant) and until when, the tools this door is listing right now, and every app you can reach — its address, what it holds, the notes it keeps and whatever the person has said in that space. Signed out it reads nothing about anybody: the same words for everyone.',
  },
  'gallery_search': {
    'title': 'Search the gallery',
    'description':
      'Find an app somebody has already made and shown at https://yaks.app/gallery — a recipe box, a sign-up sheet, a tracker. Give it the words the person used. Each answer carries the line that gives them their own copy of it, at their own address with their own data. Read it before building something from scratch, and signed out too: the gallery is public.',
  },
  'memory_save': {
    'title': 'Keep what they said',
    'description':
      'Keep what the person said about how they want something built or handled — their words, as they said them. Reach for it the moment they state a preference, a standard, a taste, a way of working, a thing they never want done again: "use grams, never cups", "keep it soft, not technical", "always show me the link". Save the SENTENCE, verbatim — never your summary of it, never a tidied-up version, never what you concluded from it. A summary can only lose what they said, and nobody can get it back. Add context only where the words are unreadable without it — one line saying what was being talked about, and no more; the words themselves carry the rest. It is kept for the whole space, so everyone working there sees it, and the about tool hands the newest few to any agent that asks. What is only about ONE app belongs in that app\'s NOTES.md instead (guide page notes).',
  },
  'memory_recall': {
    'title': 'What they have said',
    'description':
      'What the person has said about how they want things done, in their own words, ranked by what your words are about. Ask BEFORE building or changing an app, and whenever a choice is theirs to have made — how a page should look, what a thing should be called, how they want to be told about something. The newest few ride on every connection already; this is how the rest are found. Answers each memory whole, with the line of context saved beside it.',
  },
  'app_stats': {
    'title': 'Who visited an app',
    'description':
      "How many people opened the app, and where they came from: visits a day for the last month, the pages they opened, the sites that linked to them, and the countries they were in. Aggregate counts and nothing else — there is no visitor here to identify, no address and no session, so this can never answer who someone was or what one person did. Reach for it when they ask whether anyone is reading the thing, or which page is worth working on. Only the app's own people may ask.",
  },
}
