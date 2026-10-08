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
  (`unseen.ts` `refusal`).
- **A store**: one Durable Object per app (`graph.ts`), a graph composed from
  the packages: `appVocab(manifest)`, @yaks/durable-object's storage over
  @yaks/sqlite, `graph()`, `api()` and sockets. It owns no behavior of its own.
- **The directory**: the store named `yak/platform` on the platform's own
  vocabulary (`directory.ts`, `meta.ts`): spaces, apps, members, deploys.
  Every door asks it who may do what before a request reaches an app's store.
- **Serving an app**: `apps.ts` serves its files and `./api/*`; `door.ts`
  hands the store the caller's standing, including its access mode
  (`x-yak-access`). A platform page's parts are `ui-building`'s.
- **The connector**: `mcp.ts` and `tools.ts`, the tools Claude and ChatGPT
  call; `prompts/` and `public/docs/` are what those assistants read.
- **Spending**: `models.ts` and its allowance, the one budget per account
  (M-42105). An app's builders are `builders-and-builds`.
- **Keys**: a key a space or app uses is a connection, kept in the directory's
  vault; an app is handed only a sentinel, swapped for the key on the way out
  (`outbound.ts`). That whole corner is `secrets-and-connections`.

## Deploying

A push to main deploys, through Cloudflare Workers Builds (watch paths
`workers/yak/*` and `packages/*`). Nothing gates it; the gate reports. So the
safety lives in recovery, and recovery is quick:

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
  `search-and-embeddings`).
- **Rows read are billed**, and stores collect no planner statistics yet
  (T-61475): a filter that misses the archetype index scans the store.
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
- **A deploy installs.** Deployment POSTs materialize schema and lens
  descriptions, shipped rows, command identities and embedding queue triggers.
  Schema pages come from @yaks/code's `described`: `_vocab.hash` skips an
  unchanged vocabulary, and a changed hash writes only the changed rows. That
  is separate from the storage schema stamp. `schemaReady` trusts the physical
  `schema` stamp a completed installation leaves, epoch and archetypes
  included; description bookkeeping never invalidates it, and a cold ordinary
  request inspects no SQL schema signatures when it matches. What installing a
  changed word still reads is T-65622.
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
  schema preparation before a named tool call read no app Store. A release from
  before snapshots reads its pinned deploy files, translating kept command
  grammar and reconstructing word homes without a Store fetch or a backfill.
  Only a deploy can know a retired column is empty, so that file-only reader
  keeps the declaration until the next deploy records what the Store accepted.

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
- `yak admin errors` lists errors by Sentry issue (`--since`, 10m by default).
  Sentry runs out of events monthly, so an empty answer may mean blind, not
  healthy, until the platform's own tracker lands (D-45640).
- `yak admin tail` follows live events. It streams local Wrangler stdout, not
  the MCP door; its account check runs once before the stream, so following
  logs is not app traffic.
- `yak admin throwaway [name]` signs this box in as `<name>@bot.yak.sh`, a test
  account for probes, to name per command with `--as`.
- An app's own errors surface through `app_errors` and the unseen block
  (`unseen.ts`).
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
