---
name: yaks-app
description: >
  How the yaks.app platform works: the kernel Worker in workers/yak, its stores
  (one Durable Object per app, plus the directory), an app's vocabulary on top
  of the platform's core words, access modes, the connector's tools, deploys,
  budgets and what a Durable Object can't do. Use it whenever you change
  anything under workers/yak, touch a store, an app's vocab.json or its stored
  rows, add or rename a platform word, change a connector tool, its prompts or
  the guide, spend money on an account's behalf, or debug a yaks app that is
  broken, slow, refusing or showing the wrong thing, even if the request only
  names an app ("jill's app", "yourname/trip"). Not for the box's own server
  (`yak serve`). Designing words is `vocabulary`, moving stored rows is
  `data-migration`, a platform page's parts are `ui-building`, vectors and
  `.near` in a store are `search-and-embeddings`, an app's builders are
  `builders-and-builds`, its tests are `testing`, and a key it calls out with is
  `secrets-and-connections`.
---

# The yaks.app platform

Every person's apps run here: their recipe boxes and trip plans, their
sign-ins, the message they haven't sent yet. Every commit on main reaches all of
them within minutes, and nothing stands in between. A change that is merely
wrong on the box can lock someone out here, lose what they typed or break their
app, and a careless wake is billed by the row across every store at once.

So work here the way you'd work in a building full of other people's things:
gently with what they hold, quick to put back what you moved, aware that every
room you walk into costs something. What we're proud of is quiet: an app that
costs nothing while nobody is in it, a deploy nobody notices, a rename a client
never feels. What makes us wince is a deploy that signs everyone out, a default
that opens a door, a poll that wakes every store on the platform.

workers/yak/README.md is the reference for bindings, the Worker's own secrets
and setup; this is the map and the feel.

## The parts

- **The kernel Worker** (`workers/yak`). `index.ts` is the entry the runtime
  loads; `kernel.ts` is the router, and every route runs inside one catch that
  reports a failure (`unseen.ts` `fault`) and lets a deliberate no pass
  (`unseen.ts` `refusal`). A door with a catch-all of its own answers through
  `defects.ts` `refusing`: a refusal or a relayed answer keeps its status, and
  a failure raised there is reported and thrown on, never answered as a 4xx.
- **A store**: one Durable Object per app (`graph.ts`), a graph composed from
  the packages: `appVocab(manifest)`, @yaks/durable-object's storage over
  @yaks/sqlite, `graph()`, `api()` and sockets. It owns no behavior of its own.
- **The directory**: the store named `yak/platform` on the platform's own
  vocabulary (`directory.ts`, `meta.ts`): spaces, apps, members, deploys.
  Every door asks it who may do what before a request reaches an app's store.
  What its writes owe (a release's commit, a trash notice) is an effect its
  pool works after the write answers, so a test that reads one awaits the
  platform's `settled()` first.
- **Serving an app**: `apps.ts` serves its files and `./api/*`; `door.ts`
  hands the store the caller's standing, including its access mode
  (`x-yak-access`). Every HTML page leaving for a browser is woven the
  platform's inline scripts (`page-script.ts`): the reporter, the release
  listener, and on the free plan the "Made with yaks.app" badge
  (`public/badge.js`). A platform page's parts are `ui-building`'s.
- **The connector**: `mcp.ts` and `tools.ts`, the tools Claude and ChatGPT
  call; `prompts/` and `public/docs/` are what those assistants read.
- **Spending**: `models.ts` and its allowance, the one budget per account
  (M-42105). An app's builders are `builders-and-builds`.
- **Drawing**: yak-raster (`raster/`), the Worker behind RASTER, draws an
  app's icon.svg as the icon.png a home screen reads (`raster.ts`). It is its
  own Worker because resvg is 2.4 MB of WebAssembly, which every isolate of
  the kernel, each waking Store included, would compile on start.
- **Keys**: a key a space or app uses is a connection, kept in the directory's
  vault; an app is handed only a sentinel, swapped for the key on the way out
  (`outbound.ts`). That whole corner is `secrets-and-connections`.

## Deploying

A push to main deploys, through Cloudflare Workers Builds (watch paths in
workers/yak/wrangler.ts `WATCHED`: the Worker's source, not its tests or
READMEs). Nothing gates it; the gate reports. So the safety lives in recovery,
and recovery is quick:

- A push Builds starts no build for is caught by the box's deploy catch-up
  (@yaks/admin's service): 15 minutes after main's head landed, not live, it
  starts main's build through a deploy hook, marks the commit `rebuilt`, and
  reports to the tracker; a commit whose build still doesn't go live is marked
  `failed`, reported, and not built again.
- `yak admin revert <sha>` reverts a main commit in a fresh worktree, lands it
  and waits for Workers Builds to serve the revert. Since main deploys on every
  push, this is the usual way back.
- `yak admin rollback` is for a broken build path. It refuses to cross a data
  migration boundary, so it never lands on code that can't read what a newer
  release moved.
- `deno task verify:yak` checks the public doors and watches three minutes of
  live traffic for a 5xx after a deploy.

Staging (yaks.fyi) deploys after production from the same build, so it is a
sandbox for billing, not a canary.

"Live at 100%" is the Worker. Each Durable Object (a store, the directory)
moves to the new version on its own, seconds to minutes later; Cloudflare
releases them eventually consistently. So a call from the new Worker can reach
a store still on the previous code: a new store route or RPC answers as
missing for a while, and a probe right after a deploy can see the old
behavior. A bug's occurrence carries the version it ran (`commit`); one from
the previous version in that window is the lag, not the change. Keep a
Worker-to-store call working against the previous store code. The tracker's
own deploy waits for its object (`workers/tracker/deploy.ts`).

The same deploy carries two container images: the builder's sandbox and the
app compiler (`yak-esbuild`, a Worker in front of native esbuild, built from
packages/esbuild by workers/yak/esbuild/Dockerfile). Workers Builds has Docker,
so wrangler builds them, pushes them to Cloudflare's registry and rolls the
containers out; nothing is pushed by hand. A push that changes packages/esbuild
rolls the compiler out with it, and one that changes neither its Worker nor its
image skips it (`wrangler.ts` `images`). A dry run that must not need Docker
passes `--containers-rollout=none`.

## Inside a Durable Object

A store is SQLite inside a Durable Object, and the room is smaller than the
box. A query that works on the box can be refused in a store.

- **SQLite limits** (packages/durable-object/testing.ts `LIMITS`): 100 bound
  values, an expression 100 deep, a compound select of 5 arms. Only
  `transactionSync` makes a transaction.
- **No clock while code runs.** Time advances only across I/O, so a time budget
  reads 0 ms. Work is bounded by rows or batches (`mover.ts`).
- **128 MB per isolate**, shared by every object in it (`HELD` in
  packages/embedding/held.ts caps vector copies at 48 MB; the vectors are
  `search-and-embeddings`). The kernel Worker has the same 128 MB, so a body
  that can be large is read as it arrives, never held whole: the drop door
  reads its form and zip as they stream (form.ts, unzip.ts) and pins each
  file as it comes out (tools.ts `pinning`).
- **Rows read are billed.** Installation keeps planner statistics through
  @yaks/sqlite's `analyzed`: Durable Objects permit optimize but refuse
  analysis_limit, so an analyze reads full indexes. Installation only owes
  tables in a durable receipt in the existing schema metadata, and the alarm
  analyzes them a table at a time (`#analyzing`, @yaks/sqlite `analyze`): a
  table that was empty and holds rows, a populated table or index lacking
  statistics after a schema change, every populated table at tenfold growth in
  stored bytes (not row density). One whole-file analyze in the request that
  found a deploy cost the directory 200,000 rows and 2.7 s (T-65622).
  Complete existing statistics are adopted once. Remember empty tables and
  use plain `count(*)` with comparison in JavaScript: workerd bills zero rows
  while empty; `LIMIT 1` and SQL comparisons still bill a row. Optimize alone repeats empty-table analysis, scanning stat1
  and stat4 while its outer cursor omits that work. Prove reopened installs
  with the kernel's row counters and check per-store analytics after the next
  deploy; a JS incarnation restart alone need not reopen SQLite. Measure costs
  on a throwaway copy; a person's store is no benchmark fixture.
- **A boot is all or nothing.** It runs in one transaction. A schema that won't
  stand unwinds, and the store answers every request 503 with the reason
  (`graph.ts` `#stalled`), still keeping the writes it is sent (`writes.ts`),
  until fixed code arrives as a new incarnation. So a shape change or a backfill
  has no place in boot. It goes to the store mover (`mover.ts`): from the
  alarm, once the store serves, a few dozen rows a batch with requests in
  between. A batch that fails unwinds and waits for the next incarnation while
  the store keeps serving the shape it holds. `yak admin move --rehearse` runs
  every rule in a transaction the store rolls back and says what it found.
  Moving rows people already have is `data-migration`'s ground.

## Asleep is the normal state

Most apps, most of the time, have nobody in them, and an idle store is where
cost hides in work that feels free in code and is billed by the row: a store
that reads itself every minute with nobody playing (T-65228), a connector call
that wakes every app store in the caller's spaces (T-65378), a wake that asks
the directory about every trashed store on the platform (T-65467), a journal
written beside every app's rows (T-65227).

Good work here keeps a clear sense of who owes what: a deploy installs, an
alarm does what was recorded, a read reads, and a store nobody touches costs
nothing.

Use receipts help the idle test-space sweep; they are background bookkeeping,
kept alive with the Store's `waitUntil` or the request's background context.
They never hold up a person's response or make it fail. A missed receipt cannot
cost a person's work because any space with a person in it stays outside this
sweep; report the receipt failure as a defect and serve the request. Reading
app listings, diagnostics or permissions through the platform is observation,
not use of those apps, and adds no activity hop to those reads.

- **An alarm does recorded work.** An app alarm fires its stored wakes, moves
  explicitly owed schema rows, drains recorded effects whose handlers it
  composes and drains queued embeddings (`graph.ts`). Pending effects with no
  composed handler don't arm it. Durable Objects run effects with
  `singleOwner: true`: attempts and outcomes are durable, and process presence
  and run leases have nothing left to guard.
- **A read only reads.** It installs no descriptions, sweeps no sessions,
  reconciles no calls, re-owes no guest registration and joins no startup
  pool. Migration work is armed by a deploy or a mover command (`yak admin
  move`), never by a cold read.
- **A deploy installs.** Deployment POSTs materialize schema, lens
  descriptions, shipped rows, command identities and embedding queue triggers.
  The platform's own two stores have no deploy POST: every commit on main is
  their release, and the first request under a new Worker version arms their
  alarm for the pass (`#deploying`) and is served at an ordinary wake's cost
  (`version_wake_workerd_test.ts`).
  An app store's schema pages are derived from its vocabulary when read
  (@yaks/code's `describing`), so a deploy writes none; the platform's own two
  stores write theirs with `described`, where `_vocab.hash` skips an unchanged
  vocabulary and a changed hash writes only the changed rows. That is separate
  from the storage schema stamp. `schemaReady` trusts the physical
  `schema` stamp a completed installation leaves, epoch and archetypes
  included; description bookkeeping never invalidates it, and a cold ordinary
  request inspects no SQL schema signatures when it matches. The first request
  after a deploy that changed a store's words still inspects its standing
  schema (the catalogue and a pragma a table): rows in proportion to its
  vocabulary, never to what it holds.
- **App stores keep no journal** (T-65227). They don't load @yaks/journal, and
  declaring journal names in an app manifest doesn't turn it on; their
  inspector reads schema and entities without history. Journal tables and rows
  already standing stay as they are, since deleting them would itself be billed
  writes.
- **A trashed store sleeps.** Trashing or restoring an app or its space commits
  a `notify_trash` effect in the directory beside the mark (`trash.ts`). It
  tells every affected store, retries until acknowledged, and reads the present
  state so an older retry can't undo a restore. A directory restart reconciles
  standing marks through its effect sweep; app wakes never ask the directory
  about trash. The store keeps a `dormant` object-storage mark, deletes its
  alarm and closes its sockets; every runtime entry checks that mark before
  graph boot or SQL, and a dormant fetch answers 404. Restore clears the mark
  and arms the store for owed wakes. Permanent erasure stays reachable while
  dormant.
- **Discovery leaves stores asleep** (T-65378). An app's accepted vocabulary
  and commands are release metadata in R2 (`declaration.ts`), selected by the
  directory's source and declaration pointers. A deploy writes that snapshot
  before committing either pointer, including the retained words and
  borrowed-home declarations the Store accepted; a space rename copies the
  snapshots and app erasure sweeps them. `initialize`, `tools/list` and the
  schema preparation before a named tool call read no app Store. Every release
  a pointer selects has a snapshot, so a missing one is a defect the tracker
  hears about, never a reason to rebuild one from files.

The idle regression is `workers/yak/idle_alarm_workerd_test.ts`, measured
through the real Store and SQL cursor counters over a synthetic history with
linked sessions, answered calls and stale statistics. Rows returned aren't
rows billed, so native plan and full-scan tests sit beside the cursor
measurement rather than standing in for it.

## An app's words

A store's vocabulary is the platform's core documents plus the app's own
`vocab.json` (`vocab.ts` `appVocab`), and today they share one namespace. A new
manifest can't declare a platform word (`RESERVED`, `unsaid`); a word the app
held before the platform took it stays the app's in its own store (`beneath`).

So the platform taking a word reaches into everyone's apps, and a collision
breaks that app's store and every door that reads it. `deno task app-grep`
searches every app's live files and kept versions; it is how you find out
whether a word is free before you take it. Namespacing (D-59567) is designed,
not built. Shaping the word is `vocabulary`'s ground.

An app's `"platform"` dependencies (its package.json) add their packages'
words on top (`vocab.ts` `lent`), as their code reaches its pages: the
declaration a deploy hands the store carries `packages` (`stated`), and every
package's `./vocab` is bundled into the Worker (load.ts). Configured facets
stay static for synchronous store composition; extra package facets initialize
only when named. Async doors await `loadPackages` before synchronous `appVocab`,
`lentDocs`, `unlent` or `grew` reads them: wake loads the remembered declaration,
and release selection prepares the target before its transaction. The checked
`vocabFacet` accessor refuses an unprepared known facet rather than silently
lending nothing. Literal dynamic imports keep real deferred initializers in
the single Worker bundle; a static import behind a getter would not. A dependency
adds the components a store keeps
(not page-only `sync: none` ones, nor its rules, tools or effects), never
changes a word the store already speaks, and lends no `_` machinery word (no
journal). Its word declared in vocab.json too refuses the deploy (`unlent`), and one a
package takes later stays the app's in its store; a release that stops naming
a dependency keeps it while its words hold rows (`grew`).

An app-grep audit distinguishes live files, kept versions and published offers.
The mirror's `.releases` indexes are deployed versions; the directory's
`.published` rows name which pinned release an install serves. Follow those
pointers when saying what published code sends, rather than treating every
kept release as a published offer.
What app-grep cannot see sends too: a page already open runs the code it
loaded and nothing reloads it, so rewriting a person's files leaves their open
tab sending the old form, and a store keeps queries of its own. An old form a
door stops reading breaks those first (M-37853). So a store's query and socket
doors note each retired spelling the grammar translates, with the app that
sent it and the hour it last did (`translated{app, spelling, at}` in the
platform store, workers/yak/used.ts): `yak admin query yak/platform
'.translated' --as admin` lists who still sends one. A translation goes only
when app-grep finds no sender and that list has none for a while.

## People's things

The platform is where other people keep what matters to them, and these follow
from that:

- **Access fails closed.** A missing or unknown mode reads as private
  (packages/member/words.ts `mode()`), and the directory reports an app row
  with none. A default that opens something is a leak waiting for a stale row.
- **A guest writes through a vouched via**, with no person (`session.ts`). The
  same cookie holds the browser before sign-in and the person after it.
  `attribution.ts` follows directory receipts to fill missing authors in each
  app, preserving the original stamps. Analytics never receives this identity.
- **Stored pace is per entity, component and vouched via** (`member/pace.ts`),
  with durable `_pace{writes}` clocks. Signing in keeps its browser clock;
  different entities and instruments don't hold one another up. Writes with no
  via share one clock on that entity's component.
- **What people hold keeps working** (M-37923): sign-ins, links, tokens, tickets
  in an inbox. The owner, verbatim: "signing everyone out is not acceptable if
  it could be avoided. same goes for all other tokens". A change to how they are
  made migrates them.
- **Input is precious** (M-59093). The owner, verbatim: "everything they input
  into a computer is precious and should be preserved". A draft, an unsent
  message or a form gets no short lifetime.
- **Money spends from one budget per account** (M-42105), whatever the source.
  Something new that costs money spends from it rather than growing an
  allowance of its own; embedding calls don't count yet (T-59279).

## The connector

Once a listing is published, clients build on it. A tool's name, arguments,
answer and `outputSchema` keep answering until the next listing (M-37853); a
rename serves the old name as a translation (`published.ts`). Prompts and
examples start from the person's own situation, never a scenario invented for
them (M-37856; the owner on one such example, verbatim: "these are still
made-up scenarios"). The guide's list of taken words lives in
`public/docs/components.md`, and `guide_test.ts` keeps it true.

Guide pages live in `workers/yak/public/docs/<slug>.md`; their frontmatter
supplies the connector's title, brief and description. Link each offered page
from `workers/yak/public/docs.md` and add its slug to `PAGES` in
`workers/yak/guide.ts`. After editing a page, run `deno task content`
to regenerate `workers/yak/content.ts` and the connector skills under
`plugins/yaks.app/`; don't edit those projections by hand. Check with
`deno task content --check` and
`deno task test workers/yak/guide_test.ts workers/yak/content_test.ts`, plus
`deno task test:budget` on the tests you change. Examples and claims must be
checked against the implementing packages and working apps, not just against
other prose.

## Debugging an app

These commands pick a yaks.app account with `--as`. Without it they act as the
configured person's own account, which on this box is the owner's. A write is
stamped with the account that made it, and his name belongs only on an act he
asked for (M-31958), so platform work goes `--as admin@bot.yak.sh`: the
platform's admin, an owner of `yak`, which stands as an owner in every space
through the connector's graph tier (tool.ts `roleIn`).

- `yak admin query <space>/<app> <query>` reads a store, and
  `yak admin apply <space>/<app> <bundles>` patches, adds or deletes its rows
  through the store's own apply (`--check` rehearses and keeps nothing). Both
  go through `graph_query` and `graph_apply` with `space` and `app`.
- `yak admin errors` reads platform bugs through the independent tracker's
  signed door (`--since`, 10m by default). Every unexpected caught failure
  reports to the tracker with its catch location (M-37965); a new platform
  bug mails the owner through workers/tracker's delivery.
- `yak admin tail` follows live events. It streams local Wrangler stdout, not
  the MCP door; its account check runs once before the stream, so following
  logs is not app traffic.
- `yak admin throwaway [name]` signs this box in as `<name>@bot.yak.sh`, a test
  account for probes, to name per command with `--as`.
- An app's own errors surface through `app_errors` and the unseen block
  (`unseen.ts`).
- A hang reports nothing from inside. Cloudflare's own record of every
  invocation (outcome, wall and CPU time, the object it ran in) is Workers
  observability, read with the cloudflare-api MCP's `telemetry/query`; an
  event's timestamp is when the invocation ended. Calls to a store that wait
  with 0 ms CPU, ended by resets saying "instance is no longer active" or
  "internal error; reference = …", are the runtime stalling that object, not
  our code. Every app door reads its app row from the directory, so a stalled
  directory hangs the whole platform; the tracker's minute probe
  (workers/tracker/monitor.ts `PROBES`) asks such a door and files a bug.
- Row profiles (packages/durable-object/profile.ts) count SQL statements, not
  invocation events, and their labels follow asynchronous work, timers from a
  socket close included: a repeated `ws close` bucket can be a pending save
  retry (packages/api/save.ts) rather than repeated close callbacks. In a save
  query, an entity waiting on time and one missing its non-time eligibility
  look alike; only the former owns a clock retry.
- The examples to look at live in the `yourname` space (M-37804).

## Tests

Most worker tests run on the deno platform against the in-memory kernel its
process shares (`probe.ts` `kernel`). One that needs a whole kernel takes its
own (`fresh`). A `*_workerd_test.ts` is for what only the runtime has, and
shares the run's one workerd (`workerd`). Tests on a shared kernel keep apart
by their own data. The money paths use the Stripe sandbox. The rest is
`testing`'s.

When this skill is wrong or missing something, fix it in the same change.
