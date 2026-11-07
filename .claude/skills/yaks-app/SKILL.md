---
name: yaks-app
description: >
  Use for workers/yak, kernel Workers, stores, app vocab/rows, platform
  words, connector tools/prompts/guides, space spending, or
  broken/slow/refusing yaks apps. This is the hosted platform; local yak
  serve is separate. Shapes are vocabulary; migrations are data-migration;
  pricing is yaks-app-business.
---

# The yaks.app platform

Every person's apps run here: their recipe boxes and trip plans, their sign-ins,
the message they haven't sent yet. Every commit on main reaches all of them
within minutes, and nothing stands in between. A change that is merely wrong on
the box can lock someone out here, lose what they typed or break their app, and
a careless wake is billed by the row across every store at once.

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
  `defects.ts` `refusing`: a refusal or a relayed answer keeps its status, and a
  failure raised there is reported and thrown on, never answered as a 4xx.
- **The front** (`front/`): yak-front holds the routes and answers what Site's
  cache holds (`kept-page.ts`), so a request answered from the edge doesn't wait
  for the kernel to start: its upload is 11 KB against the kernel's 3.7 MB, and a
  hit through a service binding runs no code of the Worker behind it. It holds
  no secret and opens no store: everything else, and every failure of its own,
  goes to the kernel unchanged. So a module it imports reaches no graph stack;
  check the upload's size when you add one. A first-time visitor gets their
  instrument at the first door that uses one, not with a kept page.
- **A store**: one Durable Object per app (`graph.ts`), a graph composed from
  the packages: `appVocab(manifest)`, @yaks/durable-object's storage over
  @yaks/sqlite, `graph()`, `api()` and sockets. It owns no behavior of its own.
  Every object is hinted to eastern North America (door.ts `STORES_AT`), and
  Cloudflare puts it near the Worker that first reaches it there, so one the
  kernel reaches first stands beside it (ORD, IAD), since the kernel makes every
  call a store answers. Elsewhere in the region costs each call more (EWR about
  12 ms, MIA about 25, T-149707). An object never moves, so a store far from it
  (`/api/relocate?where=<handle>&colo=IAD` says where one stands, reaching a new
  name first from the kernel) moves to a new object through relocate.ts:
  `?store=<handle>&prepare=<new>`, then `&to=<new>`, which hands every request
  on and names the new object in `app.store`. `yak admin relocate [--move]`
  does it for every far app, and answers each store's line.
- **The directory**: the store named `yak/platform` on the platform's own
  vocabulary (`directory.ts`, `meta.ts`): spaces, apps, members, deploys. Its
  file stands in the object `PLATFORM_OBJECT` (`door.ts`), near Chicago; an
  object can't move, so moving it is a new name there and a copy. Every
  door asks it who may do what before a request reaches an app's store. What its
  writes owe (a release's commit, a trash notice) is an effect its pool works
  after the write answers, so a test that reads one awaits the platform's
  `settled()` first.
- **Names and handles**: what the platform keeps for a space or an app is named
  by a handle written at birth, `space.store` (`ada.1f7c3e`, the root of its
  keys in the bucket) and `app.store` (`ada/cookbook.385dac`, its Durable Object
  and script), never by its address. A rename is a directory write (directory.ts
  `rename`); the address left behind redirects until another space takes it,
  which anyone may (D-131924).
- **The serving copy**: a copy of the directory's answers (`directory-copy.ts`,
  `serving-copy.ts`) that stands in when the directory stalls. The directory's
  own answer stands as read and is copied behind it, off the request's path; a
  copied body answers only while the copy holds its revision current. A
  directory write raises a fence on the copy until it commits, so a copied body
  from before it never answers, and asks for it above the revision it holds
  committed, so a copy that fell behind costs the write nothing. A directory that can't answer for a moment (a
  throw, a 5xx, no revision) is waited out, at most `FENCE_WAIT`, never refused,
  and a read that gives up says what its last look saw. A store takes the
  kernel's word at the revision it read, and rereads the directory only for a
  request older than one it already acted on. Every call on a request's path is
  a round trip someone waits for: the copy once cost more than the directory
  reads it checked (T-132705), so keep its calls behind the answer, and ask it
  only after a read has gone `STALL` without one.
- **Asking the directory**: the reads a request starts in one turn travel as one
  trip (directory-copy.ts `gathered`, the store's `/reads`), each answered its
  own line. So a page starts everything it needs at once and awaits it together
  (apps.ts `desk`, `foresee`), and only a read that needs another's answer comes
  after it: a second read waited on in turn is a wait, a second read started
  beside the first costs nothing.
- **Serving an app**: `apps.ts` serves its files and `./api/*`; `door.ts` hands
  the store the caller's standing, including its access mode (`x-yak-access`).
  Every HTML page leaving for a browser is woven the platform's inline scripts
  (`page-script.ts`): the reporter, the release listener, and on the free plan
  the "Made with yaks.app" badge (`public/badge.js`). A platform page's parts
  are `ui-building`'s.
- **The connector**: `mcp.ts` and `tools.ts`, the tools Claude and ChatGPT call;
  `prompts/` and `public/docs/` are what those assistants read.
- **Spending**: `models.ts` and `meter.ts`, one model and voice budget per
  space (D-131886). An app's builders are `builders-and-builds`.
- **Drawing**: yak-raster (`raster/`), the Worker behind RASTER, draws an app's
  icon.svg as the icon.png a home screen reads (`raster.ts`). It is its own
  Worker because resvg is 2.4 MB of WebAssembly, which every isolate of the
  kernel, each waking Store included, would compile on start.
- **Previews**: yak-browser (`browser/`), the Worker behind BROWSER, renders a
  draft for app_preview with puppeteer and checks it with axe-core
  (`browser.ts` asks it; `browser/capture.ts` renders). Its own Worker for the
  same reason as yak-raster.
- **Sandboxes**: yak-sandbox (`sandbox/`) holds the Workbench Durable Object (the
  SDK's Sandbox) and its container, which the kernel's WORKBENCH binding names, so the Sandbox SDK
  is compiled only by isolates that run one. A container's HTTPS to the
  platform comes back to the kernel's `SandboxOutbound`, which swaps its
  placeholder for its grant (`sandbox.ts` `swapped`), since only the kernel
  holds the secret.
- **Keys**: a key a space or app uses is a connection, kept in the directory's
  vault; an app is handed only a sentinel, swapped for the key on the way out
  (`outbound.ts`). That whole corner is `secrets-and-connections`.

## Deploying

A push to main deploys, through Cloudflare Workers Builds (watch paths in
workers/yak/wrangler.ts `WATCHED`: the Worker's source, not its tests or
READMEs). A build whose kernel bytes match the serving version's (`inputs:`
digest, wrangler.ts `kernelStep`) makes no new version, since a new version
starts every isolate cold: it deploys the serving one under its commit. The
build is deterministic, so keep it so: a stamp, sha or time in the bundle or
`public/` would make every push a new version again.
Nothing gates it; main's CI reports asynchronously and files bugs.
Nobody waits for CI or a deploy to finish their work. Safety lives in recovery,
and recovery is quick:

- A push Builds starts no build for is caught by the box's deploy catch-up
  (@yaks/admin's service): 3 minutes after main's head landed, not live and with
  no build of it running (its `Workers Builds: yak` check run on GitHub), it
  asks main's deploy hook for a build (none starts while one is queued), marks
  the commit `rebuilt`, and reports a build it started to the tracker; a commit
  whose build still doesn't go live 15 minutes later is marked `failed`,
  reported, and not built again.
- The same catch-up times every deploy, push to live, as
  `deployed{pushed, live}` on the commit, and reports `deploy slow:yak` when the
  median of the last ten passes two minutes, and `deploy down:yak` when the home
  page doesn't answer once the head is live. Main's gate never waits on or times
  a deploy, so a slow or failed Cloudflare build can't turn it red
  (bench/deploys.md).
- `admin_revert` with `<sha>` reverts a main commit in a fresh worktree, lands
  it and returns after the push. Workers Builds serves the revert
  asynchronously; no landing waits for a deploy. Since main deploys on every
  push, this is the usual way back.
- `admin_rollback` is for a broken build path. It refuses to cross a data
  migration boundary, so it never lands on code that can't read what a newer
  release moved.
- `deno task verify:yak` checks the public doors and watches three minutes of
  live traffic for a 5xx after a deploy.

Staging (yaks.fyi) deploys after production from the same build, so it is a
sandbox for billing, not a canary.

"Live at 100%" is the Worker. Each Durable Object (a store, the directory) moves
to the new version on its own, seconds later; Cloudflare releases them
eventually consistently. A busy object finishes on the code it has for up to
five minutes before taking up a deploy (wrangler.toml `[durable_objects]
code_update_strategy`, deferred, `max_delay = 300`), so an Operator is not
reset under its reply (T-145428). A store a newer Worker reaches restarts for its deploy:
a write first, a read behind its answer, on the code it has (running.ts
`behindAnswer`), since the restart's new instance can take seconds to start. A
store still behind its caller answers a refusal as a failure the caller's door
retries, and reports it (running.ts `skewed`). So a call from the new Worker can reach a store
still on the previous code: a new store route or RPC answers as missing for a
while, and a probe right after a deploy can see the old behavior. A bug's
occurrence carries the version it ran (`commit`); one from the previous version
in that window is the lag, not the change. Keep a Worker-to-store call working
against the previous store code. A restart can cut off an answer already being
read, so the store door (door.ts `storeOf`) reads every answer it may send again
whole inside its retry, and a caller never handles a reset. A lost connection
("Network connection lost.") is a reset too (@yaks/durable-object `moved`): a
call cut off is sent again, and an instance whose own storage lost its
connection reports nothing it meets, since its replacement redoes the work
(defects.ts `redone`). A reset that still
outlasts the retries files under one bug per wording (defects.ts `defect`),
whichever caller and deploy it names. The tracker's own deploy waits for its object
(`workers/tracker/deploy.ts`).

The same deploy carries two container images: the builder's sandbox and the app
compiler (`yak-esbuild`, a Worker in front of native esbuild, built from
packages/esbuild by workers/yak/esbuild/Dockerfile). Workers Builds has Docker,
so wrangler builds them, pushes them to Cloudflare's registry and rolls the
containers out; nothing is pushed by hand. A push that changes packages/esbuild
rolls the compiler out with it, and one that changes neither its Worker nor its
image skips it (`wrangler.ts` `images`). A dry run that must not need Docker
passes `--containers-rollout=none`.

## Inside a Durable Object

A store is SQLite inside a Durable Object, and the room is smaller than the box.
A query that works on the box can be refused in a store.

- **SQLite limits** (packages/durable-object/testing.ts `LIMITS`): 100 bound
  values, an expression 100 deep, a compound select of 5 arms. Only
  `transactionSync` makes a transaction.
- **No clock while code runs.** Time advances only across I/O, so a time budget
  reads 0 ms. Work is bounded by rows or batches (`mover.ts`). The same holds
  for traces: every SQL span reads 0 ms, so a stretch of synchronous work is
  timed by the I/O on either side of it.
- **A new object rarely shares an isolate with the last new one.** Six app
  stores made 20 s apart each found no earlier new store in its isolate
  (T-143307), so a cache kept in module scope did not serve one new store's
  first request. Prove a cache hits live before counting on it.
- **A new object takes 150 to 500 ms to start** before any code of ours runs
  in it (T-143307). Start it beside what the request already waits on, with
  `WARM` (door.ts, used.ts `start`), which touches no storage, so a start
  nobody follows up leaves nothing behind: a birth's. A store that stands is
  sent `WAKE` (used.ts `wake`), which brings it up as any request does (boot,
  release, owed writes) and answers nothing else, so the call behind it finds
  it booted. A page view wakes its app's store for the scripts that ask it
  next, from the edge too (page-cache.ts `shown`, front.ts through `Uses`).
- **An isolate's first wake runs every path cold.** Its boot and first read
  cost a store 130-320 ms of CPU against a warm wake's 5-15 ms (T-148354):
  each function runs for the first time, and each per-isolate derivation (a
  vocabulary's words, its description rows) is made then. A bench in one
  process times warm code, so measure a first wake in a fresh process over a
  stored copy of the object (CPU profile with `deno run --cpu-prof`). Keep
  what the first request runs to what its answer needs: work nobody waits for
  (re-arming an owed alarm, `#start`) runs behind the answer.
- **An object's trace leaves out its CPU.** Its spans and
  `time_to_first_byte_ms` advance only across I/O, so a cold Builder whose
  handler span read 126 ms spent 279 ms of CPU, and its caller's fetch of it
  took 761 (T-148780). Time an object by its caller's fetch span (Workers
  observability, by `$metadata.traceId`) beside the invocation's
  `cpu_time_ms`. Everything run before a handler returns is the caller's to
  wait for, and so is the confirmation of every write made before it. So a
  read does only what its answer needs first: a schema is fitted once (a
  Store once a Worker version, graph.ts `#stood`; the Operator's store once
  a schema print, operator-store.ts `FITTED`), a
  migration that finished says so once (channel-move.ts `CHANNELED`), and
  the rest starts in a timer once the answer has returned (build.ts
  `#behind`, running.ts `behindAnswer`). An object's clock stands still
  while its code runs, so a timer set after a stretch of CPU is counted from
  before it: on a new isolate the read path's 100 ms of compiling used up
  `#behind`'s beat, which now counts only time the object heard go by
  (@yaks/fp `heard`, T-150377).
- **128 MB per isolate**, shared by every object in it (`HELD` in
  packages/embedding/held.ts caps vector copies at 48 MB; the vectors are
  `search-and-embeddings`). The kernel Worker has the same 128 MB, so a body
  that can be large is read as it arrives, never held whole: the drop door reads
  its form and zip as they stream (form.ts, unzip.ts) and pins each file as it
  comes out (tools.ts `pinning`).
- **Rows read are billed.** Installation keeps planner statistics through
  @yaks/sqlite's `analyzed`: Durable Objects permit optimize but refuse
  analysis_limit, so an analyze reads full indexes. Installation only owes
  tables in a durable receipt in the existing schema metadata, and the alarm
  analyzes them a table at a time (`#analyzing`, @yaks/sqlite `analyze`): a
  table that was empty and holds rows, a populated table or index lacking
  statistics after a schema change, every populated table at tenfold growth in
  stored bytes (not row density). One whole-file analyze in the request that
  found a deploy cost the directory 200,000 rows and 2.7 s (T-65622). Complete
  existing statistics are adopted once. Remember empty tables and use plain
  `count(*)` with comparison in JavaScript: workerd bills zero rows while empty;
  `LIMIT 1` and SQL comparisons still bill a row. Optimize alone repeats
  empty-table analysis, scanning stat1 and stat4 while its outer cursor omits
  that work. Prove reopened installs with the kernel's row counters and check
  per-store analytics after the next deploy; a JS incarnation restart alone need
  not reopen SQLite. Measure costs on a throwaway copy; a person's store is no
  benchmark fixture.
- **A boot is all or nothing.** It runs in one transaction. A schema that won't
  stand unwinds, and the store answers every request 503 with the reason
  (`graph.ts` `#stalled`), still keeping the writes it is sent (`writes.ts`),
  until fixed code arrives as a new incarnation. A release whose words throw as
  the store selects it is no boot: the tracker hears it, the release before
  keeps serving, and the next deploy is selected (`#select`). So a shape change
  or a backfill has no place in boot. It goes to the store mover (`mover.ts`):
  from the alarm, once the store serves, a few dozen rows a batch with requests
  in between. A batch that fails unwinds and waits for the next incarnation
  while the store keeps serving the shape it holds. `admin_move` with rehearse
  true runs every rule in a transaction the store rolls back and says what it
  found. Moving rows people already have is `data-migration`'s ground.

## Asleep is the normal state

Most apps, most of the time, have nobody in them, and an idle store is where
cost hides in work that feels free in code and is billed by the row: a store
that reads itself every minute with nobody playing (T-65228), a connector call
that wakes every app store in the caller's spaces (T-65378), a wake that asks
the directory about every trashed store on the platform (T-65467), a journal
written beside every app's rows (T-65227).

Good work here keeps a clear sense of who owes what: a deploy installs, an alarm
does what was recorded, a read reads, and a store nobody touches costs nothing.

Use receipts help the idle test-space sweep; they are background bookkeeping,
kept alive with the Store's `waitUntil` or the request's background context.
They never hold up a person's response or make it fail. A missed receipt cannot
cost a person's work because any space with a person in it stays outside this
sweep; report the receipt failure as a defect and serve the request. Reading app
listings, diagnostics or permissions through the platform is observation, not
use of those apps, and adds no activity hop to those reads.

- **An alarm does recorded work.** An app alarm fires its stored wakes, moves
  explicitly owed schema rows, drains recorded effects whose handlers it
  composes and drains queued embeddings (`graph.ts`). Pending effects with no
  composed handler don't arm it. Durable Objects run effects with
  `singleOwner: true`: attempts and outcomes are durable, and process presence
  and run leases have nothing left to guard.
- **A read only reads.** It installs no descriptions, sweeps no sessions,
  reconciles no calls, re-owes no guest registration and joins no startup pool.
  Migration work is armed by a deploy or a mover command (`yak admin
  move`),
  never by a cold read.
- **A deploy installs.** Deployment POSTs materialize schema, lens descriptions,
  shipped rows, command identities and embedding queue triggers. The platform's
  own two stores have no deploy POST: every commit on main is their release, and
  the first request under a new Worker version arms their alarm for the pass
  (`#deploying`) and is served at an ordinary wake's cost
  (@yaks/durable-object's wake logic). An app store's schema pages are derived from
  its vocabulary when read (@yaks/code's `describing`), so a deploy writes none;
  the platform's own two stores write theirs with `described`, where
  `_vocab.hash` skips an unchanged vocabulary and a changed hash writes only the
  changed rows. That is separate from the storage schema stamp. `schemaReady`
  trusts the physical `schema` stamp a completed installation leaves, epoch and
  archetypes included; description bookkeeping never invalidates it, and a cold
  ordinary request inspects no SQL schema signatures when it matches. The first
  request after a deploy that changed a store's words still inspects its
  standing schema (the catalogue and a pragma a table): rows in proportion to
  its vocabulary, never to what it holds.
- **App stores keep no journal** (T-65227). They don't load @yaks/journal, and
  declaring journal names in an app manifest doesn't turn it on; their inspector
  reads schema and entities without history. A store still holding the journal's
  tables from that window drops them in its next schema pass (migrate.ts
  `unjournaled`, T-131164).
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
- **Discovery leaves stores asleep** (T-65378). An app's accepted vocabulary and
  commands are release metadata in R2 (`declaration.ts`), selected by the
  directory's source and declaration pointers. A deploy writes that snapshot
  before committing either pointer, including the retained words and
  borrowed-home declarations the Store accepted; they sit under the space's
  handle, so a space rename moves none, and app erasure sweeps them.
  `initialize`, `tools/list` and the schema preparation before a named tool call
  read no app Store. Every release a pointer selects has a snapshot, so a
  missing one is a defect the tracker hears about, never a reason to rebuild one
  from files.

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

An app's `"platform"` dependencies (its package.json) add their packages' words
on top (`vocab.ts` `lent`), as their code reaches its pages: the declaration a
deploy hands the store carries `packages` (`stated`), and every package's
`./vocab` is bundled into the Worker (load.ts) so a store composes them with no
list of its own. A dependency adds the components a store keeps (not page-only
`sync: none` ones, nor its rules, tools or effects), never changes a word the
store already speaks, and lends no `_` machinery word (no journal). Its word
declared in vocab.json too refuses the deploy (`unlent`), and one a package
takes later stays the app's in its store; a release that stops naming a
dependency keeps it while its words hold rows (`grew`).

An app-grep audit distinguishes live files, kept versions and published offers.
The mirror's `.releases` indexes are deployed versions; the directory's
`.published` rows name which pinned release an install serves. Follow those
pointers when saying what published code sends, rather than treating every kept
release as a published offer. What app-grep cannot see sends too: a page already
open runs the code it loaded and nothing reloads it, so rewriting a person's
files leaves their open tab sending the old form, and a store keeps queries of
its own. An old form a door stops reading breaks those first (M-37853). So a
store's query and socket doors note each retired spelling the grammar
translates, with the app that sent it and the hour it last did
(`translated{app, spelling, at}` in the platform store, workers/yak/used.ts):
`yak admin query yak/platform
'.translated' --as admin` lists who still sends
one. A translation goes only when app-grep finds no sender and that list has
none for a while.

## People's things

The platform is where other people keep what matters to them, and these follow
from that:

- **Access fails closed.** A missing or unknown mode reads as private
  (packages/member/words.ts `mode()`), and the directory reports an app row with
  none. A default that opens something is a leak waiting for a stale row.
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
- **Money spends from one budget per space** (D-131886), whatever the source.
  Something new that costs money spends from it rather than growing an allowance
  of its own; embedding calls don't count yet (T-59279).

## The connector

Once a listing is published, clients build on it. A tool's name, arguments,
answer and `outputSchema` keep answering until the next listing (M-37853); a
rename serves the old name as a translation (`published.ts`), listed in
`tools/list` like any tool: a client installed from a directory's snapshot
checks the live list before it calls, and a name missing there fails in the
client ("was not returned by tools/list") without reaching us. A client also
holds every answer to the `outputSchema` its tool is listed with and refuses
one that doesn't fit, after we answered 200. Every tool whose answer is
entities is listed with agent.ts `ROWS`, the generic bundle plus the row words
a store and the composing read put beside components (`kind`, `space`): a new
row word is declared there, or every read answering it fails in the client.
@yaks/mcp checks each answer against its listing as it leaves and reports one
that doesn't fit.

Prompts and examples start from the person's own situation, never a scenario
invented for them (M-37856; the owner on one such example, verbatim: "these are
still made-up scenarios"). The guide's list of taken words lives in
`public/docs/components.md`, and `guide_test.ts` keeps it true.

Guide pages live in `workers/yak/public/docs/<slug>.md`; their frontmatter
supplies the connector's title, brief and description. A title is the subject's
standard technical name (Frontend Data, Backend Code, Performance), and the page
is explicit, technical reference (`writing-documentation`). Link each offered
page from `workers/yak/public/docs.md` and add its slug to `PAGES` in
`workers/yak/guide.ts`. After editing a page, run `deno task content` to
regenerate `workers/yak/content.ts` and the connector skills under
`plugins/yaks.app/`; don't edit those projections by hand. Examples and claims
must be checked against the implementing packages and working apps, not just
against other prose.

## Debugging an app

These commands pick a yaks.app account with `--as`. Without it they act as the
configured person's own account, which on this box is the owner's. A write is
stamped with the account that made it, and his name belongs only on an act he
asked for (M-31958), so platform work goes `--as admin@bot.yak.sh`: the
platform's admin, an owner of `yak`, which stands as an owner in every space
through the connector's graph tier (tool.ts `roleIn`). A live check (an app, a
subscription, the Operator) runs in `checks`, the agents' own space, `--as
checks`; `operator_run --space checks` reaches its Operator. `checks` is in
idle-spaces.ts `PROTECTED`, so the sweep never takes it. Nothing an agent tests
runs in `jeff` or another person's space.

- `yak admin query <space>/<app> <query>` reads a store, and
  `yak admin apply <space>/<app> <bundles>` patches, adds or deletes its rows
  through the store's own apply (`--check` rehearses and keeps nothing). Both
  go through `graph_query` and `graph_apply` with `space` and `app`.
- `admin_errors` reads platform bugs through the independent tracker's
  signed door (every unresolved one; `--since` narrows by last seen). It
  summarizes time to fix; `resolved: true` adds full explanations of past
  fixes. Every unexpected caught failure reports to the tracker with its catch location
  (M-37965); a new platform bug mails the owner through workers/tracker's
  delivery. Beside it on the tasks MCP server (and `yak bug …` under the
  default config), `bug_show` reads one bug by the global id admin_errors
  lists, with its kept occurrences (tags, stack, request), and `bug_resolve`
  marks it with its explanation once its fix is live, as the last step of
  every fix: `broke`, `cause`, `since`, `fix`, `recur`, a commit by a short
  sha as Git reads it; on the CLI a long `--broke`, `--cause` or `--recur`
  reads a file as `@path`. A bug that only stopped is not fixed and stays
  open; `bug_reopen` takes back a resolution whose cause was never fixed, and
  `bug_archive` hides one that needs no fix.
- `yak admin tail` follows live events. It streams local Wrangler stdout, not
  the MCP door; its account check runs once before the stream, so following logs
  is not app traffic.
- `yak admin throwaway '<command>' [--name <name>]` runs one shell command as a
  test account, `<name>@bot.yak.sh`, and erases the account when it ends. `yak
  auth yaks.app --as <address>` keeps a test account across commands; the daily
  sweep erases it after seven idle days. `yak admin erase <address> --as
  admin@bot.yak.sh` erases one now.
- An app's own errors surface through `app_errors` and the unseen block
  (`unseen.ts`). Each distinct one starts its space's Operator (unseen.ts
  `fix`, one request per break by `fixOf`), and the owner's Apps page shows
  its state beside the error; `operator_read` with the space reads its work.
  The Operator's tool `platform_bug` files what yaks.app got wrong in our
  tracker.
- A hang reports nothing from inside. Cloudflare's own record of every
  invocation (outcome, wall and CPU time, the object it ran in) is Workers
  observability, read with the cloudflare-api MCP's `telemetry/query` or the
  box's own token (`secrets-and-connections`); an event's timestamp is when the
  invocation ended. An object's event can outlast its answer by a minute:
  while the object has work under way (its alarm, say), the runtime holds the
  last request's event open until that work ends or another request comes. So
  the directory's `/used` read 44 s and a seats query 21 s while their callers'
  fetch spans took 17 and 629 ms (T-149085, the alarm remaking two releases).
  Before calling an event's wall time a wait, read its caller's fetch span
  under the same `$metadata.traceId`. Calls to a store that wait
  with 0 ms CPU, ended by resets saying "instance is no longer active" or
  "internal error; reference = …", are the runtime stalling that object, not our
  code. Every app door reads its app row from the directory, so a stalled
  directory hangs the whole platform; the tracker's minute probe
  (workers/tracker/monitor.ts `PROBES`) asks such a door and files a bug.
- Row profiles (packages/durable-object/profile.ts) count SQL statements, not
  invocation events, and their labels follow asynchronous work, timers from a
  socket close included: a repeated `ws close` bucket can be a pending save
  retry (packages/api/save.ts) rather than repeated close callbacks. In a save
  query, an entity waiting on time and one missing its non-time eligibility look
  alike; only the former owns a clock retry.
- The examples to look at live in the `yourname` space (M-37804).

## Tests

Worker behavior is checked in Deno against in-memory kernels (`probe.ts`
`kernel`, or `fresh` for one test's own kernel). Shared kernels keep tests apart
through their own data. No workerd, server, process or network test runs here;
payment decisions use controlled responses at the payment interface. `testing`
has the selection and fixture details.

When this skill is wrong or missing something, fix it in the same change.
