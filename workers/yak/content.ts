// Generated — do not edit. The words live in the files:
// public/docs/*.md (a page's frontmatter), prompts/*.md (a prompt's), and
// tools.yml (what each tool says about itself). Change one of those and run
// `deno task content`; `deno task content --check` refuses this file when it
// has fallen behind (gen.ts, T-34606).
//
// A Worker has no filesystem, so this is how words written in files reach an
// isolate: as a module it imports like any other. The types are the
// hand-written ones this stands in for, imported for their shape alone.
import type { Page } from './guide.ts'
import type { Said } from './prompts.ts'
import type { Words } from './tool-words.ts'

/** Every guide page's row, by slug. */
export let PAGES: Record<string, Page> = {
  'clipping': {
    'slug': 'clipping',
    'title': 'Web Clipping',
    'description':
      "Web clipping, saving a page somebody is reading on another site into the app's store: a worker route that fetches the URL and reads its JSON-LD, Open Graph and meta tags and title with HTMLRewriter, one row per URL, a recipe example that keeps the picture, a bookmarklet that opens the app's clip page, why a script on another site cannot write to an app (no cross-origin writes), what to tell the person when a site blocks the fetch, and re-clipping a page on a schedule with a worker command and a wake.",
    'brief': 'web clipping, saving a page from another site',
  },
  'code': {
    'slug': 'code',
    'title': 'Backend Code',
    'description':
      "Backend code for an app: worker.js, the server module that answers an app's requests before its static files. Which routes it receives (a 404 falls through to the files, /api/ is reserved), what env holds (STORE, APP, FILES, the keys the person connected, and wrangler.jsonc bindings such as D1, R2, Vectorize, vpc_services and ai), API keys through sentinels and ./api/fetch, the request headers that identify the visitor (x-yak-person, x-yak-role, x-yak-app), the CPU and subrequest limits, error handling, and complete example workers (webhook, paid API, RSVP). TypeScript and npm packages in a worker or a page's scripts: package.json, the package-lock.json app_deploy pins them in, and what the compile refuses. The platform's @yaks packages, named \"platform\", whose components the app's store also keeps. Deploying a site built in the sandbox with Vite, Astro, Eleventy or SvelteKit. Check the draft worker and pages with app_preview, including screenshots, console messages and page errors, before releasing them.",
    'brief':
      'backend code in worker.js, env bindings, API keys; TypeScript, npm',
  },
  'components': {
    'slug': 'components',
    'title': 'Components and vocab.json',
    'description':
      "Every built-in component an app already has (doc, task, filed, comment, alias, attachment, created and the rest), property by property, and vocab.json for declaring an app's own components: the property types, schema refusals, who may write a component and how often (floor, pace), rows kept to members (readers), a component kept from readers below a level (shown), private per-person rows (personal), full-text search on a property, what a later deploy may change, the reserved component names, when to use a property instead of doc.body, and edges.",
    'brief':
      "the platform's built-in components, and declaring your own in vocab.json",
  },
  'domains': {
    'slug': 'domains',
    'title': 'Custom Domains',
    'description':
      'Serving a space or one of its apps at a domain the person already owns: domain_attach, domain_status and domain_detach, the CNAME and ownership TXT DNS records and where to add them at GoDaddy, Namecheap, Squarespace and the other registrars, apex domains and the three ways to serve one, what each provisioning status means, the HTTPS certificate, and why a domain stays pending.',
    'brief': 'serving a space or an app at a custom domain (DNS, CNAME)',
  },
  'entities': {
    'slug': 'entities',
    'title': 'Cross-App Data',
    'description':
      "Sharing data between apps: two of the person's apps writing components on the same entity (one eid) without copying it; which app a component lives in and its home app in a space; type conflicts; components across spaces; how a page reads a sibling app with store(); and how graph_query with no app named combines several stores into one bundle per entity.",
    'brief': 'one entity shared by several apps, and reading across apps',
  },
  'errors': {
    'slug': 'errors',
    'title': 'Errors and Rollback',
    'description':
      'The error codes an ./api/ endpoint refuses with and how a page shows them, the error reporter in every page and POST ./api/report, where an error is filed and how the agent is told about it once, app_errors, app_versions and app_rollback, the 30-day trash (app_delete, space_delete, app_restore, space_restore), store_restore and file history, and feedback for anything you or the person have to say about the platform itself.',
    'brief': 'error codes, error reports, rollback and the trash',
  },
  'files': {
    'slug': 'files',
    'title': 'Files and Uploads',
    'description':
      "Build and check a private draft with app_preview before app_deploy: screenshots at phone and desktop widths, page console and errors, isolated test data and a private preview URL, without a local computer. app_deploy's reload levels and the yak-release event, including a custom notice that keeps unsaved input; app_files — what a write returns, the patch and fetch ops, the version history every write keeps and the restore op, page URLs and 404 handling, icon.png and icon.svg for the app's icon — then upload() for a file from an <input> or a drop: the ./api/blob URL the bytes are served from, the attachment and image rows it writes, large files uploaded in parts and resumed, who may upload, deleting an upload and its bytes, the vocab.json size and type limits, downscaling images before upload, a photo gallery without duplicate rows, and publish() for a public file served to anyone at a path of the app's URL, before the app's worker and regardless of its access.",
    'brief':
      'private draft previews, files, releases, uploads, searchable PDFs and web pages, scanned documents, document questions and page citations',
  },
  'forms': {
    'slug': 'forms',
    'title': 'Forms and Sign-ups',
    'description':
      "Forms and sign-up sheets as rows: a `form` with its `question` rows, the public door at ./api/form/<name> that shows one and takes its answers whatever the app's access, and what a sign-up sets off without any code: a `registration` only the app's owners and editors read, a letter to the person who signed up, and a letter with their answers to each person the form notifies. Opening and closing dates, a capacity, drawing a form on a page, and a plain HTML form that posts to the door.",
    'brief':
      "forms anyone can fill in, whose sign-ups email the person and the app's own people",
  },
  'games': {
    'slug': 'games',
    'title': 'Multiplayer Games',
    'description':
      'Building a multiplayer game, following Holdfast: platform dependencies and their vocabulary, game state in the graph, @yaks/game rules, input controls and HUD, @yaks/stage rendering, @yaks/voxel geometry and @yaks/voxel/three, the shared clock and fixed-step timing, owner election (one page simulates each entity), and retrying a lost write without charging twice.',
    'brief':
      'multiplayer games with rules, input controls, a HUD and rendering',
  },
  'home': {
    'slug': 'home',
    'title': 'Front Page and Routing',
    'description':
      "The front page (homepage) app served at <space>.yaks.app/ and how requests in a space are routed: app_set home, the five-step routing order, the first globs that send another app's paths to the front page's worker, the reserved platform paths, fail-open routing, changing a space's address with space_set, reserved names, and email sent to <space>@yaks.app.",
    'brief':
      "the app at a space's root address, and how a space routes requests",
  },
  'library': {
    'slug': 'library',
    'title': 'Document Q&A',
    'description':
      'Document Q&A, a public app where anyone with the link asks questions and gets answers with citations from a library of documents its owner and editors keep: open access with "models": "open", "blob": {"floor": "editor"} so only editors upload, uploading many PDF and Word files at once, watching their text extraction, adding documents from an agent with library_add, library_list, library_read and library_remove, keeping web articles with a worker route that fetches the page and uploads it as a document, full-text and semantic search, ./api/documents/ask with its citations, linking a cited article to its original address, and what limits a visitor\'s questions.',
    'brief': 'a public app that answers questions from a library of documents',
  },
  'mail': {
    'slug': 'mail',
    'title': 'Email',
    'description':
      "Sending and receiving email from an app: the app's email address (<space>.<app>@yaks.app), the rows that send an email and who may send one, the delivered and bounced rows that record the outcome, replies and threading, how incoming email is stored with its attachments, the monthly email limit, confirmed email subscriptions for notices declared with notice: true, unsubscribe links, and what yaks.app email does not support.",
    'brief': "sending and receiving email at an app's own address",
  },
  'memory': {
    'slug': 'memory',
    'title': 'Memories',
    'description':
      "store_memory_save and store_memory_recall: keeping what the person said about how they want things done, in their own words rather than your summary of them — what belongs in a memory, what context is for and what it is not, when to reach for each tool, how a recall is ranked, how a memory differs from an app's NOTES.md, and where a document you wrote goes instead: project documents, written into the app's store as entities and found again with search.",
    'brief':
      "store_memory_save and store_memory_recall, the person's words verbatim",
  },
  'models': {
    'slug': 'models',
    'title': 'AI Models',
    'description':
      "Calling AI models (LLMs) from an app with no API key: a page writes a transcript entry naming a model, the app's store calls the model, and the reply is written as rows in the same transcript for any subscribed page to receive. Instructions, typed questions answered as rows (a choice, a yes-or-no, a score), image generation with OpenAI's GPT Image models, audio from a connected model, builders over stored rows, a single synchronous call through ./api/ai/run or a worker's AI binding, image input, the commands a model may call, who may call a model, and model prices and how platform and connected models are paid for.",
    'brief': 'calling AI models from an app, with the answers written as rows',
  },
  'notes': {
    'slug': 'notes',
    'title': 'App Notes (NOTES.md)',
    'description':
      'NOTES.md beside index.html: what the person wants written down about how the app is kept, in prose, given to every agent that works on the app — where the file goes and who can read it, what belongs in it and what does not, the 4096-byte size limit, how commands, about and an MCP prompt named after the app give it to an agent, and how a published or installed copy carries it.',
    'brief': 'NOTES.md, the notes an app keeps for the agents that work on it',
  },
  'querying': {
    'slug': 'querying',
    'title': 'Query Syntax',
    'description':
      'The filter grammar used everywhere a store is read (query(), subscribe(), ./api/query, graph_query, commands, workers), with examples: presence and absence, contains, comparisons, ranges, time phrases, following references and back-references, count, tally and distinct, limit, reading one entity by id, full-text search, similarity with .near — and why a row carries only the components its filter named.',
    'brief': 'the query filter grammar, with examples',
  },
  'sandbox': {
    'slug': 'sandbox',
    'title': 'Sandbox',
    'description':
      "The sandbox: a private Linux container in the space where an agent runs commands and keeps files while it works, through sandbox_write, sandbox_shell, sandbox_wait, sandbox_stop, sandbox_read and sandbox_ship. Its uses (a script over an attachment, a CSV reconciled against an app's data, an API call, compiling to WebAssembly, building a site), the installed document tools and toolchains, installing more, how long its files last, copying files into an app with sandbox_ship, its network, how many may be awake and the monthly compute time, and the yak CLI and $YAKS_TOKEN it is signed in with.",
    'brief':
      'the sandbox, a private Linux container for running commands and keeping files',
  },
  'selling': {
    'slug': 'selling',
    'title': 'Payments',
    'description':
      "Accepting payments with Stripe: how a seller connects their own Stripe account to a space (Stripe Connect), the product component, the ./api/pay/checkout endpoint a page posts a cart to and what it returns, why a page never posts a price, the order row and the buyer's confirmation email written when the payment completes, refunds and disputes, who can read an order, test mode, and why a card number never reaches your app.",
    'brief': 'accepting payments in an app through Stripe Checkout',
  },
  'sharing': {
    'slug': 'sharing',
    'title': 'Access, Publishing and Installing',
    'description':
      "Who may read and write an app (the public, open and private access settings), inviting people with member_add to one app or the whole space, roles, letting the people an app's own rows list join it (join in vocab.json), a stranger's own copy of a private published app, kept by app_install(visit: true), and publishing and installing: app_publish, app_install, app_update, the gallery, an installed copy's independent data and borrowed connections, how it runs like the space's own apps and the sandboxed setting, version pinning, and what an update does to the data people saved.",
    'brief':
      'access settings, inviting people, publishing and installing an app',
  },
  'speed': {
    'slug': 'speed',
    'title': 'Performance',
    'description':
      "Frontend performance for a yaks app: loading a page's data in one round trip instead of a request waterfall by subscribing to what it renders, querying every kind of row in one line with |, calling me() in parallel with the reads, and awaiting subscribe(...).ready when the rows must come first. Measuring a slow page with the browser's resource timings and the Server-Timing header on every response (gateway, cold, hops), and other causes of slowness: module import chains and modulepreload, images, and work done in a subscribe callback on every change.",
    'brief': 'loading a page in one round trip, and measuring a slow page',
  },
  'stats': {
    'slug': 'stats',
    'title': 'Visitor Analytics',
    'description':
      'Visitor analytics for an app: what counts as a visit (a page view), the six fields each one records (app, space and slug, path, country, referrer hostname, client label) and what is never recorded (no IP address, no visitor id or cookie, no user-agent string), the app_stats tool and its days window, the Visits page in the app manager, the ./api/stats endpoint a page reads its own counts from, sampling, and why a small number is usually crawlers.',
    'brief': 'page view counts for an app, by page, referrer and country',
  },
  'storage': {
    'slug': 'storage',
    'title': 'Realtime Sync and Persistence',
    'description':
      "Choose which component values stay in one page, reach the store, or are relayed to other pages. Learn sync, durable, pace and save through Mossvale's saved positions and Holdfast's timed creatures, including disconnects, local drafts and the difference between relay and storage.",
    'brief': 'sync, durable, pace and save for multiplayer state',
  },
  'store': {
    'slug': 'store',
    'title': 'Frontend Data',
    'description':
      "The frontend data API, ./api/client.js, in full: every function it exports; apply, query, search, subscribe, upload, digest, me, the outbox of unsaved writes, qr for SVG QR codes and store(base) for another app's store; the bundle of components a write sends; patching and deleting; compare-and-set with $was so two writers cannot both spend one value; read and write access; the created.by author stamp on a row; seed.json seed data and store_load imports; and the HTTP endpoints underneath.",
    'brief': 'reading and writing the store from a page with ./api/client.js',
  },
  'tools': {
    'slug': 'tools',
    'title': 'App Commands',
    'description':
      "Tool entries in vocab.json that let the person's agent act on an app with no page open: the generated add_ and find_ commands, an entry's description, its argument schemas and $var bindings, the apply and query actions, what a deploy refuses, commands a model may call, the view page an answer is rendered in, and how the commands and command MCP tools list and run them.",
    'brief': 'commands an app declares for an agent to call',
  },
  'voice': {
    'slug': 'voice',
    'title': 'Voice Calls',
    'description':
      "Voice calls (WebRTC audio) between the people in an app: a page joins a call through the app's ./api/rtc/ endpoint onto Cloudflare Realtime with @yaks/rtc, publishes the microphone, and receives the voices it requests. Who is speaking is the `rtc` component on the entity they speak as, relayed to every page watching it. Playing a voice through an audio element or as spatial audio with Web Audio, mute and talking state, who may join a call, and what an hour of listening costs against the space's monthly allowance.",
    'brief': 'voice calls between the people in an app, over WebRTC',
  },
  'wakes': {
    'slug': 'wakes',
    'title': 'Scheduling',
    'description':
      "Scheduling, timers and recurring jobs as data: a `wake` on any entity records when it is due, the app's own store wakes itself at that moment and stamps `fired`, and a rule the app declares decides what the firing does. Recurrence with durations, cron expressions and time zones; pausing and resuming; scheduling a command to run later; an idle game world advancing offline every five minutes, catching up a missed stretch in one firing, and pausing while nobody is playing; where a firing runs and its time and CPU limits; why there is no Cron Trigger, no `scheduled()` and no queue.",
    'brief':
      'scheduling with a wake row, recurrence, cron lines, and rules that run on firing',
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
      "Any yaks.app ideas you think I'd like, based on our chat history?\n\nWhat gets made there: an app is an index.html and whatever files sit beside it,\nserved live at an address of my own — it opens on my phone, it keeps what it\nsaves in a store of its own rather than in one browser, and it is a link I can\nsend to somebody. It can be mine alone, readable by anyone with the link, or\nopen for anyone to add to, and I can invite people into it by email address. It\ncan carry commands of its own for you to call, keep what I have told it about\nhow I want things done, and take money through Stripe. Read the guide before you\ndecide what is possible — the guide tool, or https://yaks.app/docs.md.\n\n{{having}}\n\nGive me five or so, each a line or two: what it is, and why me. Tie every one to\nsomething I have actually said or done rather than to apps in general. Then\noffer to build whichever I pick.",
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
      'Build what the person asks for as a yaks app — its own address, its own store — and hand them the link.',
    'arguments': [
      {
        'name': 'what',
        'description':
          'What they want: "somewhere to keep recipes", "a chore board for the house", "a page where my friends vote on a date".',
        'required': true,
      },
    ],
    'body':
      "Make me something on yaks.app: {{what}}\n\nBuild it as an app there — its own address, its own store — and give me the link\nonce app_deploy has released it and it opens; don't tell me it exists before\nthen. Keep whatever it saves in the app's own store, so it is the same on my\nphone. If other people are meant to use it, or it needs to be more than one\npage, ask me before you deploy.",
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
      'I want to share {{app}} on yaks.app with {{who}}.\n\nWork out what its access should be first — whether they have to sign in, and\nwhether anyone else with the link could write — and tell me what you picked.\nThen invite them, and tell me they accept from the letter they receive.',
  },
}

/** What every tool says about itself, by name. */
export let WORDS: Record<string, Words> = {
  'mcp_connect': {
    'title': 'Connect an MCP server',
    'description':
      "Connect or update your own MCP server. Its commands become available to your Operator and through commands/command. Sign in at the returned connection page when asked; credentials never pass through this tool. Name servers distinctly. For a server on your own machine, pass machine (a space you own whose tunnel goes to it) and the server's path there as url, such as /mcp: it is reached through the tunnel with no sign-in, and only for you.",
  },
  'space_new': {
    'title': 'Create a space',
    'description':
      'Create another space, a group of apps sharing an address and membership, at <slug>.yaks.app, with the signed-in person as its owner. Signing in already gave them one; this makes a second. Pass a slug (the short name in the URL) and a title (its name). Returns the space name, entity id and URL. Other tools infer the space when only one fits; specify space when more than one could match.',
  },
  'space_set': {
    'title': 'Name, address, logo or visitor spending',
    'description':
      'Change a space\'s name or move it to another address, at any time, set its logo, or set how much of its monthly model and voice budget its apps\' visitors may spend. The title is its name; the slug is its address, so changing the slug moves the space to <new>.yaks.app. Every app in it moves with it, files and data included, and each app keeps its own path under the new address. The old address keeps working until someone else takes it: it redirects to the new one, path included, so an existing link still opens the same page, and email to <old>.<app>@yaks.app still arrives. The old name is free the moment the space leaves it, so another space may take it, and from then on its links and email reach that space instead. Only the space owner may rename or move it. Pass forget with a slug the space has already left to stop its redirect now: every link and every email still aimed there finds nothing. Pass visitors, a percent from 0 to 100 (25 until set), to bound what visitors to its apps may spend together each month on models and voices their manifests open to them ("models": "open", "rtc": "open"); past it, those apps tell visitors they answer again on the 1st, and members are not held to it. Pass visitor_calls (50 until set) to bound the model calls one visitor may ask its apps for in a day (UTC); past it, the apps tell that visitor they answer again tomorrow. Pass logo with an attachment id from the conversation to make that picture the space\'s logo (a PNG, JPEG, WebP or GIF up to 1 MB, no SVG), or logo_base64 with a picture\'s bytes; logo "none" takes it off. The logo stands in for the space\'s first letter wherever the space shows (its owner\'s space switcher, its list of spaces, the Operator\'s chat) and is the icon of every app in it with no icon.png or icon.svg of its own, on a home screen too. It is the logo its owner can choose on the space\'s Settings page; only the owner may set it. Returns the current address and a summary of the changes. Documentation: https://yaks.app/docs/home.',
  },
  'space_delete': {
    'title': 'Delete a space',
    'description':
      "Delete a space: it goes to the trash for 30 days. Every app in it stops answering, its address stops serving and its apps disappear from your tools, but nothing is erased, the address is held, and space_restore brings the whole space back within those 30 days. After that the platform erases it: the apps, everything they saved, their files, any domain attached to them, and the address becomes available again. This tool cannot delete the space itself: it emails the space's owner a confirmation link, valid for one hour, and returns a summary of what that link would stop. The confirmation is the owner's to give by opening that link; nothing else completes the deletion. Only the space owner may ask. app_delete trashes one app instead. With forever: true the link erases the space at once instead, with nothing kept and no undo. To undo a delete: space_restore, any time in those 30 days. Documentation: https://yaks.app/docs/errors.",
  },
  'space_restore': {
    'title': 'Restore a deleted space',
    'description':
      "Bring back a space that was deleted. Every app in it serves again at the address it always had, its tools and pages come back, and everything it saved is exactly as it was; nothing is touched while a space sits in the trash. Works within 30 days of the delete being confirmed; after that the space has been erased and there is nothing to bring back. Unlike space_delete, restoring needs no confirmation email. The caller must still be the space owner. Pass the deleted space's slug; returns its restored URL. Documentation: https://yaks.app/docs/errors.",
  },
  'space_sell': {
    'title': 'Connect Stripe to a space',
    'description':
      "Connect this space to Stripe so its apps can take payments. Requires the Plus plan and the space owner. The tool returns a link where the person finishes setting up with Stripe (their name, their bank account, whatever Stripe asks); all of that happens at Stripe, and yaks.app never sees or holds any of it. They are the merchant: the charge, the money, the name on the customer's statement, and any refunds and disputes are theirs. Nobody can sell until the person has finished at Stripe, and calling again returns a fresh link to the same Stripe account, never a second account. If setup is already complete, it returns the payment readiness and platform fee instead of a link. Once they are done, every app in the space can take payments through POST /api/pay/checkout. Pass disconnect: true to stop selling through this space; their Stripe account and everything in it stays theirs, this space just stops charging on it. Disconnecting returns a confirmation that this space can no longer charge through the account. Documentation: https://yaks.app/docs/selling.",
  },
  'app_new': {
    'title': 'Create an app',
    'step': {
      'doing': 'Creating the app %{slug}…',
      'done': 'Created the app %{slug}',
    },
    'description':
      "Create a new app, served at <space>.yaks.app/<slug>/. Pass its slug and its title (its name). Creating it does not choose a front page for the space; the owner can do that with app_set(home: true). app_files writes its files and app_deploy releases a version. Pass access when the app is for other people too: 'open' if anyone with the link should be able to write to it (vote, add a line, sign up), and 'private' if only the person and whoever they invite (member_add) should see it at all. The default access is 'public': anyone can read, but only members allowed to write can change data. Returns the app's entity id, URL and access setting. The URL serves nothing until app_deploy releases a version, so hand the person the link app_deploy answers, not this one. Documentation: https://yaks.app/docs.",
  },
  'app_files': {
    'title': 'Read or write app files',
    'step': {
      'doing': 'Working on the files of %{app}…',
      'done': 'Worked on the files of %{app}',
      'by': {
        'op': {
          '': {
            'doing': 'Writing the files of %{app}…',
            'done': 'Wrote the files of %{app}',
          },
          'list': {
            'doing': 'Listing the files of %{app}…',
            'done': 'Listed the files of %{app}',
          },
          'read': {
            'doing': 'Reading %{path}…',
            'done': 'Read %{path}',
          },
          'write': {
            'doing': 'Writing %{path}…',
            'done': 'Wrote %{path}',
          },
          'patch': {
            'doing': 'Editing %{path}…',
            'done': 'Edited %{path}',
          },
          'fetch': {
            'doing': 'Downloading %{path}…',
            'done': 'Downloaded %{path}',
          },
          'delete': {
            'doing': 'Deleting %{path}…',
            'done': 'Deleted %{path}',
          },
          'history': {
            'doing': 'Looking up earlier versions of %{path}…',
            'done': 'Looked up earlier versions of %{path}',
          },
          'restore': {
            'doing': 'Restoring %{path}…',
            'done': 'Restored %{path}',
          },
        },
      },
    },
    'description':
      "Write the app's files (index.html and any css, js or images beside it), or list, read or delete them. files: [{path, content}, …] writes a whole app in one call, with op left out; path and content write one file, and base64 in place of content writes one that is not text (an image, the .wasm a worker.js imports). Check the draft with app_preview at phone and desktop widths, including its console and errors, before app_deploy. No local files or browser are needed. Edits stay private until app_deploy releases them with the app's vocabulary and worker; released files serve at <space>.yaks.app/<app>/<path>, index.html for the directory, another page at its own name (about.html at /about), and a 404.html for a page that is not there. An app's data lives in its own store, never localStorage: a page uses `import { apply, query, search } from './api/client.js'`. Each page gets a `<base>` at its own folder under the app's address, so relative URLs still work in a copy installed elsewhere; a page in a folder reaches the client at ../api/client.js. A write returns its byte count and SHA-256, and for a .json file whether it parses and where it does not; a picture that does not decode is refused. The app's icon, the picture beside its name wherever yaks.app lists it (the space's apps, the Operator's sidebar) and on a home screen, is its icon.png: a PNG fetched there with op: fetch, or else an icon.svg written as content (a square viewBox, no <text>), which the platform draws as icon.png. An app with neither wears its space's logo (space_set logo), or the platform's default yak in a space without one. It shows once deployed. NOTES.md beside index.html holds the app's notes in the person's words (up to 4 KB), returned by the about tool; like vocab.json it is never served on the web. op: patch with path, find and replace edits one file in place; find is an exact string that must occur exactly once. edits: [{path, find, replace}, …] with op: patch makes many edits across any of the app's files in one call, in order and all or none, and answers each edit's line: send every edit a change needs as one patch call, never one call per edit. op: fetch with path and url downloads an https body to path (how a library is vendored) and returns its integrity hash. Pass op explicitly unless writing. list says each path with its SHA-256, the live version, and whether the draft differs from it (as data too: files: [{path, sha}], version and unreleased); read with path returns that file's text, and with paths several files, or with neither every text file in the app, in one call: each under its path and SHA-256, up to 64 KB in all, naming each file left out and why (as data too: files: [{path, sha, size}], unread: [{path, why}] and version). delete confirms the path. Replaced or deleted bytes are kept for 30 days. To undo any write, patch, fetch or delete: op: history with path lists them newest first (sha256, size, when, by whom), and op: restore puts one back, the newest or the one sha or at names; a restore is itself a write. op: restore with no path goes back one write: every file the newest write changed returns to what it replaced, and asking again goes back one more. Documentation: https://yaks.app/docs/files.",
  },
  'sandbox_shell': {
    'title': 'Run a sandbox command',
    'step': {
      'doing': 'Running a command…',
      'done': 'Ran a command',
    },
    'description':
      "Run one command in the person's sandbox in this space: a private Linux container where an agent runs commands and keeps files while it works. Use it for what a browser and the other tools cannot do alone: run a script over an attachment, reconcile a CSV, call an API, compile to WebAssembly, build a site with any tool (Vite, Astro, Eleventy, SvelteKit), run a generator. An app of html, css and js needs none of it. Installed: Rust 1.98.1 with wasm32-unknown-unknown, wasm-bindgen 0.2.128 and wasm-opt 132; Python 3.13.15 with pip, pypdf, pdfplumber, python-docx, openpyxl, python-pptx, pandas and Pillow; pandoc and poppler-utils (pdftotext, pdftoppm, pdfinfo); LibreOffice Writer, Calc and Impress (`libreoffice --headless`); Go 1.27.1; Zig 0.16.0, also the C and C++ compiler (`zig cc -target wasm32-freestanding -nostdlib -Wl,--no-entry` makes a module a browser loads with no glue code, -target wasm32-wasi one a WASI layer runs); Deno 2.9.1, and the image's Node and Bun. Read, edit and write PDF, DOCX, XLSX, PPTX, CSV and images with these tools. sandbox_write with an attachment id copies the original file into the sandbox. The command runs as root, so `apt-get install -y <pkg>`, cargo, pip, npm and go get install anything until the container goes. Its network reaches the whole internet, so git clone, npm create and any API work. sandbox_write puts a file in, sandbox_read reads one out, and sandbox_ship copies files into an app. It is signed in as the person: `yak` is installed with $YAKS_TOKEN and $YAKS_HOST set, so `yak <tool>` and curl call these same tools. $YAKS_TOKEN is a placeholder, which yaks.app swaps for a short-lived token of the person's on its way to yaks.app or the space's own address, and nowhere else; the token is revoked when the container is destroyed. Use is metered in seconds charged to the space: {{budget}} seconds per managed build or per call outside one, and the space's monthly allowance. One sandbox awake in a space at a time on the free tier, two on the Plus plan. A managed build destroys the container when it ends; separate MCP calls reuse it until five idle minutes put it to sleep, and its files are temporary. A command ending within timeout milliseconds returns its exit code and output, stdout then stderr; one still running keeps running for at most 240 seconds, and the answer gives its process id for sandbox_wait and sandbox_stop. What a command did through these tools to apps is not undone by discarding the container. Documentation: https://yaks.app/docs/sandbox.",
  },
  'sandbox_wait': {
    'title': 'Wait for a sandbox command',
    'step': {
      'doing': 'Waiting for the command…',
      'done': 'Waited for the command',
    },
    'description':
      "Wait for a command sandbox_shell left running in the person's sandbox in this space, by the process id its answer gave. Returns the exit code and output, stdout then stderr, or says it is still running when timeout milliseconds pass (default 60000). Waiting keeps the sandbox awake, metered by the second as with sandbox_shell. Documentation: https://yaks.app/docs/sandbox.",
  },
  'sandbox_stop': {
    'title': 'Stop a sandbox command',
    'step': {
      'doing': 'Stopping the command…',
      'done': 'Stopped the command',
    },
    'description':
      "Stop a command sandbox_shell left running in the person's sandbox in this space, by the process id its answer gave, and return its exit code. Waking the sandbox is metered by the second, as with sandbox_shell. Nothing to undo: what it already wrote to the sandbox stays, and sandbox_shell runs it again. Documentation: https://yaks.app/docs/sandbox.",
  },
  'attachment_read': {
    'title': 'Read source text',
    'step': {
      'doing': 'Reading source text…',
      'done': 'Read source text',
    },
    'description':
      'Read original UTF-8 text from a message or file by its attachment id in this space. Call inside code_mode: structuredContent.result[0].output.value.text contains the complete text, preserving whitespace, with no truncation. Parse, reconcile and verify in the script; return only counts or concise differences. This does not wake the sandbox. Binary or invalid UTF-8 files are refused; sandbox_write with attachment can write their bytes.',
  },
  'sandbox_write': {
    'title': 'Write a sandbox file',
    'step': {
      'doing': 'Writing %{path} in the sandbox…',
      'done': 'Wrote %{path} in the sandbox',
    },
    'description':
      "Write one file inside the person's sandbox in this space: a script, a data file, a Cargo.toml, whatever a command will read. These are not the app's files: nothing here is served, and files are temporary, not durable app storage. app_files stages what app_deploy will serve; sandbox_ship copies files from the sandbox into the app. Waking the sandbox is metered by the second, as with sandbox_shell. Pass a sandbox path and nonempty text, or in place of the text an attachment id from the conversation (including original message text), which writes its bytes there for a command to read. This overwrites that path without file history and returns the path written. Python includes pypdf, pdfplumber, python-docx, openpyxl, python-pptx, pandas and Pillow; pandoc and poppler-utils and LibreOffice headless are also installed. Use them to read, edit and write documents, spreadsheets, presentations, CSV and images. Nothing to undo: nothing of the app lives here, and only sandbox_ship copies sandbox files into durable app files. Documentation: https://yaks.app/docs/sandbox.",
  },
  'sandbox_read': {
    'title': 'Read a sandbox file',
    'step': {
      'doing': 'Reading %{path} from the sandbox…',
      'done': 'Read %{path} from the sandbox',
    },
    'description':
      "Read one file out of the person's sandbox in this space: a script's output, a generated source, a log, whatever the last command left behind. Waking the sandbox is metered by the second, as with sandbox_shell. Pass a path relative to /workspace. Returns the complete file text; sandbox_shell can inspect a binary file with a command. Documentation: https://yaks.app/docs/sandbox.",
  },
  'sandbox_ship': {
    'title': 'Copy sandbox files into the app',
    'step': {
      'doing': 'Copying sandbox files into %{app}…',
      'done': 'Copied sandbox files into %{app}',
    },
    'description':
      "Copy files from the sandbox into the app's draft, as if app_files had written them: a built site, a compiled .wasm, a file a script produced. Name files, folders or wildcard patterns (globs) relative to /workspace. A folder copies every file inside it and keeps its subfolders: dist lands dist/about/index.html at about/index.html. A file or glob match lands under its own name, below the deepest folder its matches share: pkg/*.wasm lands beside index.html, and dist/* lands as dist does. into names a folder of the app to land them under instead of its root, and replace: true makes that folder hold exactly what this call copies, deleting each file an earlier copy left there (kept in its history). Two different files landing on one path are refused. The app keeps the files independently of the temporary sandbox. This call does not itself destroy the sandbox. Binary files are copied as bytes, so a .wasm arrives intact. Waking the sandbox is metered by the second, as with sandbox_shell. To undo: these are written through app_files, so each keeps the bytes it replaced; use app_files op: history, then op: restore. Returns the copied paths, file count and app URL. Check the staged files with app_preview before app_deploy; it runs the browser on Cloudflare and returns the screenshot, console messages and page errors. Documentation: https://yaks.app/docs/sandbox.",
  },
  'app_preview': {
    'title': 'Preview an app draft',
    'description':
      "Build and open the staged app privately before app_deploy. Returns a private preview URL, a PNG screenshot the client displays, and console messages, JavaScript errors, the page's HTTP status and an axe-core WCAG 2.1 AA accessibility report (rule, element and one-line fix per problem, plus elements needing manual review). Fix the reported problems before deploying; findings are a report and never refuse a release. Automated checks do not prove conformance. Choose path and width (390 for a phone, 1280 for desktop), height, and wait in milliseconds. The browser runs on Cloudflare; no local files, CLI or computer is needed. Draft vocabulary, seed data and worker use a separate test store, so preview edits never change released app data. The URL is the app's private bearer link, the same across every app_deploy: a page open on it shows each file written, a stylesheet in place and anything else by reloading, and after a deploy what was released; do not publish it. screenshot: false returns only the URL without browser cost. Browser use costs $0.09/hour from the space's monthly budget; the result reports the estimated cost. External database, bucket and Durable Object bindings are not available in a draft preview. A draft worker's external service calls still reach those services.",
  },
  'app_deploy': {
    'title': 'Release a version',
    'step': {
      'doing': 'Releasing %{app}…',
      'done': 'Released %{app}',
    },
    'description':
      "Release the app's staged files as a version: files, vocabulary and worker begin serving together, and error reports name this version. Before releasing, check the private draft with app_preview at widths 390 and 1280; inspect the returned screenshots, accessibility problems, console messages and page errors and fix the files. No local computer or browser is needed. Send base as the live version the files were made on (app_files op: list says it). When base is behind, the answer names the files this draft would remove or replace and keeps it unreleased; after reviewing them, repeat with the same base and confirm: true. Leaving base out releases as usual. reload: required marks a contract change open pages must reload to use; optional (or none) derives severity from what changed. Open pages are notified after the release and never reload on their own. It creates the components the app's vocab.json declares ({{vocab}}): a component is a named group of typed fields on a stored record, an entity. A component name the platform already uses refuses the whole manifest before anything is created; a component or property the manifest no longer names that holds nothing is dropped. It reports the properties added, and those still holding values the manifest no longer names: a property with values is never renamed or retyped, so a new name is added beside the old one, which keeps its rows. A seed.json beside index.html (a list of bundles, each an entity id and its components; or a seed/ folder of *.json) is written into the store once per store, after the components; deploying again seeds nothing. A $defs entry marked \"tool\": true gives the app a command of its own ({{tools}}), which everyone who can reach the app runs with the command tool. A worker.js beside index.html is the app's server code: it handles every request not under /api/ before the files, and its 404s fall through to them. esbuild compiles TypeScript and npm packages here: a worker.ts, a worker importing a package, and each page module script that is TypeScript or imports a package package.json lists under dependencies. A compiled page script serves at its own address as JavaScript; package-lock.json pins the versions installed; a compile error refuses the deploy with the compiler's lines while the last release keeps serving. A published app's published version stays put until app_publish, and this tool says when it falls behind. Every deploy is kept. To undo: app_rollback, which moves the live pointer to a kept version. Returns the new version, URL, and any schema, seed, command or worker details. A release still going after 40 seconds answers that it is still running and goes on; app_deploy again with the same arguments waits for it and answers how it ended, in place of releasing again. Documentation: https://yaks.app/docs.",
  },
  'store_load': {
    'title': 'Load a data file into the store',
    'description':
      'Write a data file the app already contains into the app\'s store, now. path is a file (data/cities.json) or a folder, loading every *.json and *.csv under it. A JSON file holds a list of bundles, as seed.json and graph_apply take: [{"entity": {"eid": "$a"}, "doc": {"title": "…"}}]. For a CSV, `as` names the component a row becomes: as: "city" with headers name,country writes city{name, country} per row, converted to the types vocab.json declares (an object or array cell is JSON); `title` and `body` columns go into doc, and an `id` (or `alias`) column becomes alias{name}. map {"Serves how many": "serves"} renames a header. A header matching no property, or a cell that will not convert, is refused, naming the row and header. Files load in one transaction, in filename order, so an alias made in one file resolves in the next; a refused bundle writes nothing, and the refusal names the file and entry. A load over 2000 entities or 1.9 MB is written in parts of that size, each its own all-or-nothing transaction, where an alias resolves only within its part unless it carries alias: {name}. A refused part leaves the parts before it written, and a call writing for a minute stops between parts; either way the answer names the part: to pass to go on. Unlike a seed it is not once-only: each call patches and adds as the caller, with the caller\'s attribution, deletes included ($delete: true or tombstone: {}), as the store\'s access rules allow. A bundle naming an eid patches that row; one naming a $alias creates a new entity each run unless it carries alias: {name: "…"}, which resolves to the entity holding that name, so loading twice patches instead of copying, and the name works anywhere an eid does. A large dataset need not be typed into a call: app_files op: fetch downloads it into the app for store_load, or a machine that can reach the app POSTs it as NDJSON to its ./api/apply with a grant token. Returns the entities written and the source filenames (a file count past six). To undo: store_restore, to a moment just before the load. Documentation: https://yaks.app/docs/store.',
  },
  'app_versions': {
    'title': 'List app versions',
    'step': {
      'doing': 'Listing the versions of %{app}…',
      'done': 'Listed the versions of %{app}',
    },
    'description':
      'List the newest 20 kept deploys, newest first, their dates and file changes, which version is live, and recorded pointer moves (from, to, when, by whom and through which session). All deploys are kept; the total is reported, and any kept version can be selected by app_rollback. Documentation: https://yaks.app/docs/errors.',
  },
  'app_rollback': {
    'title': 'Roll back to an earlier version',
    'step': {
      'doing': 'Rolling %{app} back…',
      'done': 'Rolled %{app} back',
    },
    'description':
      'Move the live pointer to a kept version without minting a new version. Its files, vocabulary, commands and worker become live together, and the move is recorded. Leave version out for the deploy before the live one, or name any kept version from app_versions, including a newer one to undo a rollback. Existing data rows are not restored or deleted. Returns the version now live, URL and changed files. Documentation: https://yaks.app/docs/errors.',
  },
  'store_restore': {
    'title': 'Restore the store to a point in time',
    'description':
      "Put everything the app has saved back to how it was at a moment: the whole store, every row of it, as of that time. For a write that went wrong: a bad import, rows deleted by mistake, a change that turned out to be wrong. Cloudflare keeps the last 30 days of the store, so any moment in those 30 days can be restored; at is that moment, as a timestamp (2026-09-06T14:20:00Z). Called with no at, it reports the oldest moment still available and every restore already made. It is reversible: where the store stood before is recorded before anything moves, so a restore is undone by restoring again to a moment just before it, and the response names that moment. Everything written since the named moment is lost, so the latest moment that will do costs the least. The app is briefly restarted to pick up the restored store. The app's files are not part of this; app_rollback and app_files op: restore put those back. To undo: another store_restore, to the moment just before this one, which the response names. Documentation: https://yaks.app/docs/files.",
  },
  'store_trace': {
    'title': 'Record the next Store requests',
    'description':
      "Platform-admin only. Record the next N requests to an app's Store into its space's tracker. next is 0..100; optional rate sets ordinary-request sampling probability from 0 to 1. Threshold traces are retained above 10,000 rows read or written. The setting lasts for this Store incarnation; eviction clears it. The reply says whether queue delivery is available. This does not make synthetic app requests.",
  },
  'store_inspect': {
    'title': 'Inspect store size and dry-run cost',
    'description':
      "Show bounded table row counts and index names for an app's store. Name eid for bounded physical identity, tombstone and component-table presence, without component values. Name since and until to count deletions in that time window by minute, reading at most 1,000 graves; repeat with the returned next as after until next is null, adding the page counts. Name seq to dry-run one held write and report phase durations and bundle count. Only the space owner can inspect it. The dry run rolls back every graph batch; this tool never retries or applies the write.",
  },
  'store_writes': {
    'title': 'Inspect kept store writes',
    'description':
      "List writes the named app's store still holds, including interrupted writes that a storage reset stopped. Name seq to inspect one write's original body and final outcome. Set recent to list the newest 100 writes, including applied writes, with a kernel flag but never request headers. Only the space owner can inspect these private writes. Nothing is retried.",
  },
  'store_retry': {
    'title': 'Retry an interrupted store write',
    'description':
      'Explicitly retry one interrupted or unreviewed write by its seq, after inspecting its body and fixing the cause of interruption. Only the space owner can retry. The store keeps the original body, idempotency key, and full final outcome together with the graph batch. A reset may interrupt it again.',
  },
  'store_effect_retry': {
    'title': "Retry an app store's failed effect runs",
    'description':
      "Put an app store's failed effect runs back to pending with a fresh attempt allowance, after fixing what failed them, so the store works them again: a document's extraction, an upload's deletion, a builder's install. Takes a handler name, such as document_extract, for all its failed runs, or one run's id. Only the space owner can retry. A run that fails again is left failed again.",
  },
  'builder_choose': {
    'title': 'Choose an output take',
    'description':
      'Make one retained builder output the take in use for its build and slot. Other slots keep their choices. This makes no call and spends nothing. Readers selecting built.current=true use the chosen take. Only an app editor may choose.',
  },
  'builder_build': {
    'title': "Run an app's builder now",
    'description':
      "Build new bindings or ones whose own inputs changed. A changed template, model or tool never redoes current outputs by itself. outdated redoes selected bindings built under an older definition; rebuild redoes every selected binding even when nothing changed. Both combine with only and limit. An alternate template, provider, model or native input creates a shadow variant. Each successful answer retains its takes and chooses the newest in each slot by default; builder_choose selects an earlier take. A staged builder is tried only through this door. Each model turn spends the space's budget. Only an app editor may build. Returns the builds it reconciled.",
  },
  'app_set': {
    'title': 'Rename, move or reshare an app',
    'step': {
      'doing': 'Changing the settings of %{app}…',
      'done': 'Changed the settings of %{app}',
    },
    'description':
      "Rename an app, move it to another address, or change who may use it. The title is its name; the slug is its address, so a new slug moves the app, files and data included, to <space>.yaks.app/<new>/, and the old address redirects there until another app takes it. access is app_new's choice: 'public' (the default: anyone reads, members with write permission change data), 'open' (everyone with the link writes) or 'private' (members only). home makes this app the space's front page, what <space>.yaks.app/ opens; no app is the front page just by being created. home: false removes this app as the front page if it is one, never another app; with none, the space address lists the apps a visitor can open. first is the front page's own routing, as globs of paths its worker.js handles before the app owning them: [\"/recipes/*\"] sends everything under /recipes/ to the front page; an empty list puts every path back. gallery: true submits a published app to https://yaks.app/gallery, the public page of yaks apps, for review by the platform's owner; false withdraws it at once. review: false with gallery: true lists it without review: only the platform admin may, and only when the platform's owner asks. screenshot takes the eid of an image uploaded to this app through /api/blob for its gallery and homepage cards, without redeploying; an empty string clears it. forget with a slug this app has left drops it: it stops redirecting and another app can take it, final for that address. sandboxed: true runs an app installed from someone else's release in a browser origin of its own, reaching only its own data, with localStorage supplied by the platform; false lets it out again. Only the space owner may set home, screenshot, forget or sandboxed. Returns the current URL and a summary of the changes. Documentation: https://yaks.app/docs/home.",
  },
  'connection_attach': {
    'title': 'Let an app use an existing connection',
    'description':
      "Give an app access to one connected connection its space already owns. Only the space's owner may do this. The app starts members-only, receives a sentinel rather than the credential, and reads it by binding (the name its code reads, env.NAME in worker.js and from ./api/env in a page): the one given, else any it already asked for, else the service's name in capitals. Attaching a connection the app already uses, with a new binding, renames it. It reaches the running app at once, with no redeploy. Find the connection id with store_connection_list. No key or token passes through this tool or its answer. Documentation: https://yaks.app/docs/code.",
  },
  'connection_lend': {
    'title': 'Lend a connection to installed copies',
    'description':
      "Lend a shared connection this app uses to copies installed from it. Only the owner of the app's space may lend its own connection. Each copy gets a sentinel and a cap of calls a month, never the key or the source app's data. A new cap also changes copies already borrowing it. cap: null stops lending and gives every copy borrowing through this app a connection needing its own key. A copy may replace a borrowed connection with its own using connection_attach. A direct key, a connection each person connects, and a borrowed connection cannot be lent. Documentation: https://yaks.app/docs/sharing.",
  },
  'service_connect': {
    'title': 'Connect selected app service operations',
    'description':
      "Connect an app to selected operations of a published app service, as the signed-in person. This grants those operations only, never merchant store membership. Pass an empty operations list to revoke the connection. Purchases still require checkout or the payer's explicit purchase authority.",
  },
  'integration_publish': {
    'title': 'Publish an app service',
    'description':
      'Publish the app\'s service commands in the integration directory. A declared command opts in with service: {pricing: "its pricing terms"}. The listing exposes its description, input schema, revision and permission floor from the current app release. Only the app owner publishes it. listed: false withdraws discovery and preserves customer orders and connections.',
  },
  'integration_set': {
    'title': 'Describe or list a custom integration',
    'description':
      "Change what a custom integration this space made says about itself: its title, a one-line tagline, its https site, and instructions, markdown for a person and the agent helping them on how to get its key (where to sign up, which page issues the key, what to paste). Only the space's owner may do this, and only for an integration this space made with store_connection_need; a built one is the platform's. An empty value clears it. Where its key may be sent never changes. The instructions show beside every connection needing that key, on each space's connections page and on the page where a person connects their own, and in store_connection_need and store_connection_list answers. listed: true puts it in the integration directory at https://yaks.app/integrations, apart from any app, where anyone may find it and add it to a space of theirs with their own key; listed: false takes it out. Nobody reviews a listing. Documentation: https://yaks.app/docs/code.",
  },
  'integration_list': {
    'title': 'Search the integration directory',
    'description':
      'Find an outside service a yaks app can call, in the integration directory at https://yaks.app/integrations: every service in the host catalog, and every one a space added and listed. Pass the words the person used, or none for all. Search includes service descriptions, integration access and limits, categories and docs. Each result includes those descriptions, homepage and documentation links, how it connects and whether its catalog entry is unchecked. It also says the hosts its key is only ever sent to, how to get the key (written for the person and for you, to walk them through it) or that they sign in instead, and how to add it: store_connection_need with its name in a space of theirs, or the connections page the result links. It works signed out too: the directory is public. Documentation: https://yaks.app/docs/code.',
  },
  'connection_need': {
    'title': 'Say an app needs a key or a sign-in',
    'description':
      "Say that an app calls an outside service with a key or a sign-in (an API key, a Google account): it makes a connection for the person to connect on the space's connections page, and no key ever passes through this tool or this chat. Name a built integration, or any other name with the hosts its key may be sent to (integration: 'ESV', hosts: ['api.esv.org']). The app is handed a sentinel by binding (default the name in capitals), which yaks.app swaps for the key on the way out, only to those hosts, so a page may hold it: the page reads it from ./api/env, puts it wherever the service wants its key (a header, the query, the body) and sends the call through ./api/fetch?url=…, as in `fetch('./api/fetch?url=' + encodeURIComponent('https://api.esv.org/v3/passage/text/?q=John+3:16'), {headers: {authorization: 'Token ' + env.ESV}})`. A worker reads it as env.NAME and fetches the service directly. direct: true hands a worker the key itself instead, only for a key it must sign with. Until the person connects it, the name is not there; once they do, the running app has it, with no redeploy. Asking again renames or changes it. With each: true, every person who uses the app connects their own account instead, at the app's own /api/connections/<integration>, and only they call out through it. Returns the binding and the page the person connects it at. Documentation: https://yaks.app/docs/code.",
  },
  'connection_list': {
    'title': 'List connections',
    'description':
      "The space's connections to outside services: each one's service, whether it is connected, and which apps use it by which env.NAME. A key is never shown, by this tool or any other. Use it before connection_need to see what the person has already connected. Documentation: https://yaks.app/docs/code.",
  },
  'app_delete': {
    'title': 'Delete an app',
    'description':
      'Delete an app: it goes to the trash for 30 days. Its address stops answering, its tools and pages disappear from your tools, and it stops being the front page, but its files and everything it saved are kept while its slug is free immediately, and app_restore brings the whole app back within those 30 days. After that the platform erases it for good. app_files op: delete removes one file, and app_set moves an app rather than replacing it. A platform admin may trash any app. Only the space owner may use forever: true, which skips the trash and erases it now; nothing is kept and there is no undo. To undo a delete: app_restore, any time in those 30 days. Returns what was trashed or erased and, for a trash operation, how to restore it. Documentation: https://yaks.app/docs/errors.',
  },
  'app_restore': {
    'title': 'Restore a deleted app',
    'description':
      'Bring back an app that was deleted. It serves again at its old address if free, or a free numbered address otherwise; pass slug to choose another address. Its tools and pages come back, and everything it saved is exactly as it was; nothing is touched while an app sits in the trash. A platform admin may restore any app. Works within 30 days of app_delete; after that it has been erased and there is nothing to bring back. app_list shows what is in the trash and how long each app has left. Pass the deleted app eid from app_delete or app_list (and its space). Its old slug also works while no live app owns it. Returns its restored URL and a confirmation. Documentation: https://yaks.app/docs/errors.',
  },
  'app_errors': {
    'title': 'List open errors',
    'step': {
      'doing': 'Checking %{app} for errors…',
      'done': 'Checked %{app} for errors',
    },
    'description':
      "List unarchived error reports for the named app: what a page threw in someone's browser, what a request threw on the server, and what the platform reported. Each is a stored record with its own id in the tracker; ids from older app-store reports keep answering. New ones are also appended, once, to the next reply from a tool that changes something; a read-only tool leaves them unseen. `fixed` archives the ids it names, which removes them from this list and from replies; `seen` archives without listing every id: `all`, `v3` for everything up to and including that deploy, or a date. Returns any archive count followed by the remaining reports, or “no open errors”. Archiving a report does not fix the underlying problem. Documentation: https://yaks.app/docs/errors.",
  },
  'app_list': {
    'title': "List the person's apps",
    'step': {
      'doing': 'Listing apps…',
      'done': 'Listed apps',
    },
    'description':
      "What the person already has here, short enough to pass on as it is: every space of theirs and which app its address opens, a line of what its month has counted against each of its limits and what models and voice spent there (and, near or at a limit, where its plan is settled), then each app in a line with its address, its access (public, open or private), how many errors are still open in it (app_errors lists them) and how much of the space's app data and photos and files it holds, so the person can see where the space's storage goes before it fills. In a space they own, it names every invitation not accepted yet with the day its latest letter went, so \"my friend can't get in\" starts here (member_add sends another letter, member_remove withdraws one), and counts everyone else; people: true names them. Name an app to list it alone and in full: its email address, version, bindings, month's usage and everyone who can open it. Deleted apps are listed with the days each has left and what each still holds, until app_restore brings it back or the 30 days run out. Documentation: https://yaks.app/docs.",
  },
  'commands': {
    'title': 'List commands',
    'step': {
      'doing': 'Listing the commands of %{app}…',
      'done': 'Listed the commands of %{app}',
    },
    'description':
      "The commands yaks apps, connected app services and your MCP servers offer, with the arguments each one accepts. An app's own commands (the ones its vocab.json declares, and the two every component it holds gets, such as add_recipe and find_recipe) are listed here rather than in this tool list, which is the same for everybody. command runs one of them. Omit app to list all reachable apps, or pass an app slug (space/app if ambiguous), service:<app eid> or mcp:<server eid>. The result gives each command's address and says whether it reads or writes. Documentation: https://yaks.app/docs/tools.",
  },
  'command': {
    'title': 'Run a command',
    'step': {
      'doing': 'Running %{name} in %{app}…',
      'done': 'Ran %{name} in %{app}',
    },
    'description':
      "Run a command: name it and pass its arguments as args, exactly as commands lists them. Set app to the listed address for a connected service or MCP server, or when two apps declare the same name. MCP tools use your own connection and may ask you to sign in. App commands run through the app's ordinary API endpoints as the person calling it, so it can do what they could do on the page and never more. To undo whatever it wrote: store_restore, to the moment just before it ran. Returns the command result from the app. Its description in commands says what it does; restoring data cannot undo an external effect such as an email or payment. Documentation: https://yaks.app/docs/tools.",
  },
  'domain_attach': {
    'title': 'Attach a custom domain',
    'step': {
      'doing': 'Attaching %{hostname} to %{app}…',
      'done': 'Attached %{hostname} to %{app}',
    },
    'description':
      "Serve a domain the person already owns, example.com instead of yourname.yaks.app. Name an app and that app answers at the root of the domain; leave app out and the whole space answers there, exactly as it does at <space>.yaks.app: the front page at /, every app at /<app>/. A space and each of its apps can have their own domain at the same time. To answer at one address, attach both www.example.com and example.com, the second with to: 'www.example.com', and every visitor to the bare domain is sent to www, path and all; attaching an attached domain again changes only that. The tool registers the hostname here and returns the DNS record the person has to add where their domain is managed, in the response text: type, name, value. Nothing serves until that record is in place at the registrar; domain_status reports when it has arrived. Only the space owner may attach one. Custom domains require Plus unless the space is exempt. If the space is not eligible, the tool returns the plan-settings URL, where paid plans are compared in the space settings, and returns no checkout link; signing in returns the person to that page. No hostname is registered until the space is eligible. Documentation: https://yaks.app/docs/domains.",
  },
  'domain_status': {
    'title': 'Check a domain',
    'step': {
      'doing': 'Checking %{hostname}…',
      'done': 'Checked %{hostname}',
    },
    'description':
      'How far a domain has come, and what it points at: the space, or one of its apps. Whether the DNS record has arrived, whether Cloudflare has accepted the hostname, and whether the certificate is issued, each reported specifically enough to tell the person what is still waiting on them. It is read from Cloudflare, not from what was last recorded here. Leave hostname out to check every domain in the space. After domain_attach, the record, the hostname and the certificate arrive over a few minutes; nothing needs doing in between. Documentation: https://yaks.app/docs/domains.',
  },
  'domain_detach': {
    'title': 'Detach a custom domain',
    'step': {
      'doing': 'Detaching %{hostname}…',
      'done': 'Detached %{hostname}',
    },
    'description':
      "Stop serving at a domain, whether it served a space or one app. The hostname is released back to Cloudflare and what it served is untouched: it still answers at its <space>.yaks.app address, and its data and files are not involved. The person's DNS record is theirs to remove wherever their domain is managed; until they do, it points at nothing. Only the space owner may detach. To undo: domain_attach with the same hostname, which starts the certificate again. Returns the detached hostname, the original yaks.app URL and a reminder to remove the DNS record. Documentation: https://yaks.app/docs/domains.",
  },
  'number_find': {
    'title': 'Find a phone number',
    'step': {
      'doing': 'Looking for numbers…',
      'done': 'Found numbers',
    },
    'description':
      "The phone numbers on offer for a space to buy as its own, each with what it costs up front and each month. Toll-free by default; toll_free false with an area code finds local numbers. A space's own number is how it texts the public as itself, such as a church texting its members or a township texting residents; without one it texts only its owners, from yaks.app's number. Next: number_buy with the number the person chose.",
  },
  'number_buy': {
    'title': 'Buy a phone number',
    'step': {
      'doing': 'Buying %{number}…',
      'done': 'Bought %{number}',
    },
    'description':
      "Buy a number number_find offered, for the space to hold. Its price up front and its first month are spent from the space's monthly budget at once, and each later month its monthly price is spent on the day of the month it was bought, until number_release gives it back or the space is erased. Only the space owner may buy; tell the person both prices before buying. A bought number texts nothing until number_assign puts it on the space or one of its apps, and a toll-free number reaches people only once its toll-free verification (number_verify) is approved.",
  },
  'number_assign': {
    'title': 'Assign a phone number',
    'step': {
      'doing': 'Assigning %{number}…',
      'done': 'Assigned %{number}',
    },
    'description':
      "Put a number the space holds on the space, so its Operator texts from it and texts to it reach the Operator, or on one of its apps (app), so the app's texts go from it and replies reach the app's store. It moves off wherever it was before. Texts still go only to people who agreed to them. Only the space owner may assign.",
  },
  'number_release': {
    'title': 'Release a phone number',
    'step': {
      'doing': 'Releasing %{number}…',
      'done': 'Released %{number}',
    },
    'description':
      "Give a number back to the provider: it stops costing anything, texts to it stop arriving, and whatever texted from it goes back to texting from yaks.app's number. It cannot be bought back for certain, so confirm with the person first. Only the space owner may release.",
  },
  'number_verify': {
    'title': 'Verify a toll-free number',
    'step': {
      'doing': 'Filing the verification for %{number}…',
      'done': 'Filed the verification for %{number}',
    },
    'description':
      'File the toll-free verification carriers require before a toll-free number texts: the organization\'s legal name, address, kind (a church is non_profit, a township government) and EIN, a contact, what the texts are for (use_case, in the provider\'s list: "Religious Services", "Public Works", "Events & Planning" and so on), a sample text, the monthly volume, and how people agree to be texted with a picture of it. Ask the person for each; never invent them. yaks.app files as the reseller. Carriers review it over days; number_status reads where it stands, and a verification waiting on the sender says what they ask. Only the space owner may file.',
  },
  'number_status': {
    'title': 'Check phone numbers',
    'step': {
      'doing': 'Checking numbers…',
      'done': 'Checked numbers',
    },
    'description':
      'The numbers a space holds: where each texts from (the space, an app, or nowhere yet), what it costs, and where its toll-free verification stands, read from the provider now. Leave number out for every number the space holds.',
  },
  'app_publish': {
    'title': 'Publish an app for others to install',
    'description':
      "Publish this app so anyone in any other space can install it by name. Someone else then calls app_install and gets their own copy: their own store, their own address, their own data from the first byte, pinned to the version you published; nothing is shared but the code. The name is platform-wide, so it is the app's slug unless that is taken, and a taken name is refused. Publishing again publishes whatever is deployed now under the name it already has; a name is claimed once, and only an explicit new name moves it, which leaves the old name resolving to nothing. Nobody who installed it moves to the new version until they call app_update. Only the space owner may publish. gallery: true also submits it to be shown on https://yaks.app/gallery, a public page of what people have made. That is separate from publishing. It is not listed at once; an agent reviews its code first, unless it is one of the platform's own, then the platform's owner reviews the submission and decides, and the app is published either way. review: false lists it at once instead: only the platform admin may, and only when the platform's owner asks. Returns the published name and version, how to install it, and any gallery submission status. Documentation: https://yaks.app/docs/sharing.",
  },
  'app_unpublish': {
    'title': 'Unpublish an app',
    'description':
      'Stop offering the app for install. It stays exactly as it is, and so does every copy anyone installed, since their data is theirs, but nobody new can install it, and the name is free again. It leaves the gallery at the same moment, if it was on it. Only the space owner may unpublish. To undo: app_publish, which publishes it again under the same name unless somebody else has taken it meanwhile. Returns a confirmation, including whether its gallery listing or submission was removed. Documentation: https://yaks.app/docs/sharing.',
  },
  'app_published': {
    'title': 'List published apps',
    'description':
      "What other people have published here, newest first: the name to install by, what the app is, and which space it came from. app_install gives them their own copy of one, with their own data. Pass words to list only the apps whose name, title or description contain them; the match also includes the printed origin and version details. It needs no account: a published app is offered to everybody. The listing includes each source space and app slug, not a guarantee that the source app's own pages are public. Documentation: https://yaks.app/docs/sharing.",
  },
  'app_install': {
    'title': 'Install a published app',
    'description':
      "Take an app somebody published (app_published lists them) and make the person their own copy of it: their own address, their own data store, their own everything from the first byte. Nothing is shared but the code, so what they save is theirs alone and the publisher never sees it. No key travels either: the copy asks the person's space for each connection the app uses, by the same env.NAME, and they connect their own on their connections page; the answer names each and where. The copy is pinned to the version it was installed from; the publisher's next version does not arrive on its own, and app_update moves the copy forward while keeping their data. Pass the published name and optionally as for the new app slug. By default it uses the source app slug if free, otherwise the published name, adding -2, -3, and so on until free. The copy runs like the space's own apps, with the browser's own storage and access to everything in the space; the space owner's app_set(sandboxed: true) walls it off in a browser origin of its own. Returns the installed version, file count, new URL and deployment details. Documentation: https://yaks.app/docs/sharing.",
  },
  'app_update': {
    'title': 'Update an installed app',
    'description':
      "Move an installed app to whatever version its publisher offers now. The person's data stays: every row they saved is theirs and is not touched. Only the code is replaced, so anything you wrote into the copy yourself is replaced too. A vocab.json schema that only added properties is applied to their store; one that would retype a property their rows were written under is refused, and nothing moves. A connection the new version uses that the copy did not is asked for, as app_install asks. It reports what changed. To undo: app_rollback, since the update goes out as a version like any other and app_versions lists the one before it. Documentation: https://yaks.app/docs/sharing.",
  },
  'member_add': {
    'title': 'Invite someone',
    'description':
      "Invite someone by email address: an editor writes, a viewer only reads, and a space owner may also invite. Name the app and that one app is all they get, its page and its data (how a player joins one game, or a household one list); leave it out and they join the space, reaching every app in it. They are mailed an invitation, and nothing is theirs until they accept with its one click, which also signs them in with that address, no code needed. note puts the person's own line or two at the top of that email, quoted as theirs (\"the potluck list for Saturday\"), which is what gets an invitation opened. name, whenever you know it, is what their apps show beside what they write; left out, they go by the front of their address until they change it in their own settings. Nothing to install, no account to make first. Only the space owner may invite. For an app everyone with the link may write to without signing in, set access 'open' (app_set) instead. Inviting someone who already accepted changes their role and sends nothing. Invitations never count against the space's monthly emails, and one person may send 50 an hour. Returns the role and scope; the accept link goes only to the invited address, so there is none to pass on. If delivery fails, calling again sends it. Documentation: https://yaks.app/docs/sharing.",
  },
  'member_remove': {
    'title': 'Remove someone',
    'description':
      'Remove a membership, or withdraw an invitation not yet accepted: pass an app slug to revoke its app-specific invitation, or omit app to revoke space-wide membership. Independent app invitations and space-wide membership do not revoke each other. Either way the person keeps their sign-in. Only the space owner may remove, and the last owner cannot be removed, since a space with no owner is one nobody can ever open again. To undo: member_add with the same address, which puts them back where they were. Returns a removal confirmation. App-specific removal revokes an app invitation, not access inherited from space membership. Documentation: https://yaks.app/docs/sharing.',
  },
  'grant': {
    'title': 'Create a CLI token',
    'description':
      "A short-lived token that signs the `yak` CLI in as this person: the same identity and exactly the same access they have here, never more. For working from a terminal, or a script that reaches their apps; the response is the one line to paste. A script sends the token as `authorization: Bearer <token>` to an app's own endpoints, so a dataset already in your own environment goes into a store by POSTing it as NDJSON to the app's ./api/apply, never typed into a tool call (https://yaks.app/docs/store). It lasts an hour unless `hours` says otherwise (24 at most), and `space` limits it to one space, which is the right choice when the token is going somewhere less safe than their laptop. The token is shown once, in the response, and stored nowhere it can be read back. `revoke` cancels a token before it expires, by the id the response that created it named. This tool requires a browser or connector sign-in; a CLI token cannot create or revoke tokens through it. Documentation: https://yaks.app/docs/sharing.",
  },
  'screen_pair': {
    'title': 'Pair a TV',
    'description':
      'Pair a TV, or any screen with a browser, with this person, so it shows, read-only, whatever draft their agent is building: the app they last wrote a draft in, following each write as it lands and moving to the next app they work on. The TV opens yaks.app/tv and shows an eight-letter code; pass the code the person reads out ("put it on my TV, the code is BCDF-GHJK"), in any case, with or without the dash. A paired screen changes nothing and reads only this person\'s drafts. They see and unpair their screens at yaks.app/tv/pair, where they can also type the code themselves. Returns a confirmation, or says the code matches no screen.',
  },
  'feedback': {
    'title': 'Send feedback about yaks.app',
    'description':
      'Send feedback about yaks.app itself, and talk it through with the people who run it: this connector, its tools, its documentation, the way an app is built or served. A bug, a rough edge, a step that took three tries, a confusing answer, a wish, a feature idea, a thing that went well. Not for the app being built for the person: an error inside their own app is listed by app_errors. Pass text with what the person said, in their words, and what was tried and what happened; who they are, their space, the app if named, and the versions are attached automatically. It opens a support thread and returns its thread id and a link; the people who run yaks.app are told by email and answer in the thread. Pass that thread to read the replies, the fix they link and whether it is done, or thread with text to add to it. Only the person who opened a thread, a member of its space, or the platform reads or adds to one. It works signed out too: the thread then records that it came from someone signed out, and nobody can read it back, so put an address in the text if a reply is wanted. Documentation: https://yaks.app/docs/errors.',
  },
  'guide': {
    'title': 'Read the guide',
    'step': {
      'doing': 'Reading the guide on %{page}…',
      'done': 'Read the guide on %{page}',
      'by': {
        'page': {
          '': {
            'doing': 'Reading the guide…',
            'done': 'Read the guide',
          },
        },
      },
    },
    'description':
      'The guide, read here instead of fetched from the web. With no page: the overview, which says what an app is, how its pages read and write its store, and has a paragraph on every feature there is. It is the map. With a page: the whole of one subject. The pages are {{pages}}. A name that is none of them returns the overview, which lists them all. The same pages are served to a person at https://yaks.app/docs.md, and as web pages at https://yaks.app/docs.',
  },
  'about': {
    'title': 'Read what yaks.app is',
    'step': {
      'doing': 'Reading about yaks.app…',
      'done': 'Read about yaks.app',
    },
    'description':
      'What yaks.app is and what gets made here, in a paragraph. Signed out, it adds what works signed out, what signing in adds, and where to sign in, and reads nothing about anybody: the same answer for everyone. Signed in, it adds who you are signed in as, how (a browser, a connector, a CLI token) and until when, the tools this connector is listing right now, and every app you can reach: its address, what it holds, the notes it keeps and whatever the person has said in that space.',
  },
  'gallery_search': {
    'title': 'Search the gallery',
    'description':
      'Find an app somebody has already made and shown at https://yaks.app/gallery: a recipe box, a sign-up sheet, a tracker. Pass the words the person used. Each result includes the command that gives them their own copy of it, at their own address with their own data. It works signed out too: the gallery is public. Documentation: https://yaks.app/docs/sharing.',
  },
  'memory_save': {
    'title': 'Save a memory',
    'description':
      'Save a memory for the space: a sentence or a note kept for everyone working there and found again by what it is about. A person\'s own words are kept as they said them, so a preference, a standard or a way of working ("use grams, never cups", "keep it soft, not technical") comes back exactly; a note of the assistant\'s own, how or why something was built, is kept the same way. context is a line or two saying what was being talked about. It is kept for the whole space, and the about tool returns the newest few to any agent that asks. What is only about one app can also live in that app\'s NOTES.md (https://yaks.app/docs/notes), and a longer document in the app\'s store as a doc entity, which search finds. Pass said and optional context. Returns the saved words and context as confirmation. Documentation: https://yaks.app/docs/memory.',
  },
  'memory_recall': {
    'title': 'Recall memories',
    'description':
      'The memories kept for the space, ranked against the words passed: what the person has said about how they want things done, and notes saved beside them. The newest few arrive with every connection already; this finds the rest. Returns each memory whole, with the context saved beside it. Documentation: https://yaks.app/docs/memory.',
  },
  'app_stats': {
    'title': 'Read app traffic',
    'description':
      "Return page-view counts for an app: the total over the last 30 days by default, and counts by page, referring site and country. These count page loads, not distinct people. Pass days for a different window, up to 90 days; if analytics is not configured, returns that fact instead. Aggregate counts and nothing else: no visitor is identified, no address and no session is kept, so this can never say who someone was or what one person did. Only the app's own members may ask. Documentation: https://yaks.app/docs/stats.",
  },
  'sandbox_exec': {
    'title': 'Run a sandbox command (listed name)',
    'description':
      "The name sandbox_shell was listed under: run cmd in the person's sandbox in this space, in cwd (default /workspace), for at most timeout seconds (default and maximum 240). Returns the exit code and the last lines the command printed. A command can call these tools and change apps, so its effects outside the container are not undone by discarding it. New work calls sandbox_shell, which can also leave a long command running. Installed document tools: Python with pypdf, pdfplumber, python-docx, openpyxl, python-pptx, pandas and Pillow; pandoc, poppler-utils and LibreOffice headless (Writer, Calc, Impress). Documentation: https://yaks.app/docs/sandbox.",
  },
  'app_secret_set': {
    'title': 'Set a worker secret',
    'description':
      "Give the app's worker a key it reads as env.NAME. The value becomes a connection the app uses directly (connection_list shows it), kept in the vault, and no tool reads it back. Setting a name again replaces its value. New work uses connection_need, where the person pastes the key on their connections page rather than in this chat. Returns the name and a confirmation, never the value. Documentation: https://yaks.app/docs/code.",
  },
  'app_secret_list': {
    'title': 'List worker secrets',
    'description':
      "The names the app's worker reads as env.NAME from a connected key. Values are never returned, by this tool or any other. connection_list says the same with each connection's service and status. Documentation: https://yaks.app/docs/code.",
  },
  'app_secret_remove': {
    'title': 'Remove a worker secret',
    'description':
      "Stop the app's worker reading env.NAME. A key handed to the worker itself, as app_secret_set hands one, is forgotten once no other app reads it, and nothing can restore it: to undo, set it again with the value. Any other connection stays on the person's connections page. Pass the name, not its value. Returns a removal confirmation. Documentation: https://yaks.app/docs/code.",
  },
  'builder_supply': {
    'title': 'Supply a builder artifact',
    'description':
      "Answer exactly one outer binding of any builder with an artifact already in this app's store. Supply takes the builder, the first entity of its binding (for), a slot and an artifact, all as ids or aliases. It works while staged, spends nothing, and makes that slot current at the key reconciliation computes now. Later input or definition edits rebuild it normally. Other slots are left alone. Optional args keeps the original prompt, model, loudness audit or other provenance on the supplied call. Only someone who can write the app may supply. Returns the output id.",
  },
  'gallery_review': {
    'title': 'Review a gallery listing',
    'description':
      "Approve or decline a submitted gallery listing as the platform admin. Every submission goes to the platform's owner for review, so decide one only when he asks you to, and record him: by is his address, via is the session, reason records why. app names the offer as space/app. A decline leaves the app published and lets its owner submit again. Listing an app without review, which also waits for him to ask, is app_set(app, gallery: true, review: false).",
  },
  'gallery_code_review': {
    'title': "Review a gallery app's code",
    'description':
      "Record the platform admin's code review of an app somebody else asked into the gallery, and send the platform's owner its review request with the verdict and findings; he decides either way. An ask from outside the platform's own spaces comes to the admin's agents for this first, and app_files reads the app's code. verdict is approve or reject; findings says what the review found: what the app does with people's data and keys, whether it works as it says, and anything that should not be shown under yaks.app's name. by is your project, via your session.",
  },
  'operator_chat': {
    'title': "Ask your space's operator",
    'description':
      "Give this space's operator a request or a design to implement. It reads and writes this space's apps with the same tools your agent uses, including rows and deployments, and charges model use to the space's budget. The operator on your own space is your personal assistant: it also reaches your other spaces, with your role in each. Any space's owner may let another space's operator work there too, from its People page. Returns the private task and session ids, its answer and model cost in dollars. After 25 seconds of work it returns progress while the task continues; use operator_read with task for its eventual answer. Cost is recorded use so far. Pass task to continue an earlier request; operator_read reads its work. Ships changes live; app_rollback can undo a deployment. Only members who write may ask.",
  },
  'operator_run': {
    'title': "Ask your space's operator (alias)",
    'description':
      'Alias for operator_chat, with the same arguments, permissions and behavior.',
  },
  'helper_spawn': {
    'title': 'Start a helper in your operator chat',
    'description':
      "Start a helper with brief and an optional model under the private task or session returned by operator_chat, named by task. Returns its session id immediately. It acts with your permissions and charges the space's shared budget. Its report is a passive notice to that chat, included in the chat's closing notice. Only failures or choices needing the person reach the main conversation directly. operator_read and operator_stop accept the helper's session id.",
  },
  'operator_read': {
    'title': "Read your operator's work",
    'description':
      "Read this space's private operator tasks, conversations, replies and native session entries. Pass task (a task, or a conversation's session) for its lines, a conversation's newest 64, or omit it for the twenty latest tasks and conversations. While a conversation has lines before those answered, its earlier says how many and the before to pass for the 64 preceding them. Model instruction snapshots are omitted unless context is true.",
  },
  'operator_remove': {
    'title': "Remove your operator's work",
    'description':
      "Remove rows from this space's private operator work, each with what exists only because of it: a task with its comments, sessions and their lines, a conversation's session with its own lines, a line, or a wake-up or subscription with the turns it fired and what they told in Updates. You remove your own; the platform's admin anyone's. Answers the eids removed.",
  },
  'library_add': {
    'title': "Add documents to an app's library",
    'step': {
      'doing': 'Adding documents to %{app}…',
      'done': 'Added documents to %{app}',
    },
    'description':
      "Add documents to an app's library, its uploaded files whose text is extracted, searched and cited by ./api/documents/search and ./api/documents/ask (https://yaks.app/docs/library). documents: up to 20, each one of url (a PDF, Word, OpenDocument or spreadsheet file, a web page, or plain text, fetched from the web), attachment (the id of a file the person attached in their conversation with you, which their message names as \"attachment <id>\"), or base64 with name (the file's bytes). A fetched document keeps its address as attachment.source, and a web page is kept as its article alone, without scripts, menus, headers or footers, and named by its title. name sets the name an answer cites; replaces names the eid of a document this one takes the place of, which is removed once this one is added. The upload is the caller's, held to the app's \"blob\" floor and limits like a page's POST ./api/blob, and a document is at most 32 MB. A site that refuses, whose robots.txt does not let yaks.app read the address, or that asks not to be copied (noarchive) is skipped and said, never worked around; check a site's terms before copying from it. Answers each document added, with its eid, and each skipped, with why. Extraction runs after the call: library_list says when each document is searchable, or why it could not be read.",
  },
  'library_list': {
    'title': "List an app's library",
    'step': {
      'doing': 'Looking through the documents of %{app}…',
      'done': 'Looked through the documents of %{app}',
    },
    'description':
      "List the documents in an app's library: each one's eid, name, type, the web address it came from (attachment.source), and its extraction: reading, searchable with its page count, or failed with the reason it could not be read. Documents are the uploads the library reads (PDF, Word, OpenDocument, spreadsheets, CSV, web pages, plain text); other uploads, such as photos, are not listed.",
  },
  'library_read': {
    'title': "Read a document from an app's library",
    'step': {
      'doing': 'Reading a document of %{app}…',
      'done': 'Read a document of %{app}',
    },
    'description':
      "Read the text extracted from one document in an app's library, page by page, as search reads it: document is its eid from library_list. Answers up to about 60,000 characters from page (1 if left out), and the page to read on from when there is more.",
  },
  'library_remove': {
    'title': "Remove documents from an app's library",
    'step': {
      'doing': 'Removing documents from %{app}…',
      'done': 'Removed documents from %{app}',
    },
    'description':
      "Remove documents from an app's library by their eids, from library_list: each one's file, its row and its extracted text are deleted, so search and answers no longer cite it. To replace a document with a newer copy, library_add with replaces instead.",
  },
  'operator_stop': {
    'title': 'Stop an operator conversation',
    'description':
      "Stop an operator conversation or task and every helper working under it, however deep: the step each is in is withdrawn and no step goes on past it, until new words reopen the conversation. What it already did and wrote stays. You stop your own; the platform's admin anyone's.",
  },
  'operator_retry': {
    'title': 'Retry an operator request',
    'description':
      "Run an operator request that could not finish again, as the same request, once what failed it is fixed: its failure and the answer that told of it are dropped, its files are read again, and the operator takes it up in the person's conversation. The space's people who write may retry their own requests; the platform admin may retry anyone's.",
  },
}
