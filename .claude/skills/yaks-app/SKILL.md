---
name: yaks-app
description: >
  How the yaks.app platform works, for anyone changing or debugging it: the
  kernel Worker in workers/yak, its stores (one Durable Object per app, plus the
  directory), an app's vocabulary on top of the platform's core words, access
  modes, the connector's tools, deploys, budgets and what a Durable Object can't
  do. Use it whenever you change anything under workers/yak, touch a store, an
  app's vocab.json or its stored rows, add or rename a platform word, change a
  connector tool, its prompts or the guide, spend money on an account's behalf,
  or debug a yaks app that is broken, slow, refusing or showing the wrong thing,
  even if the request only names an app ("jill's app", "yourname/trip"). Not
  for the box's own server (`yak serve`); designing words is the `vocabulary`
  skill and moving stored rows is `migrate`.
scope: tasks-v2
volatility: stable
---

# The yaks.app platform

Every person's apps run here, and every commit on main reaches them within
minutes. A change that is merely wrong on the box can lock someone out, lose
their input or break their app here. workers/yak/README.md is the reference for
bindings, secrets and setup; this is the map and the judgment.

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
  (`x-yak-access`).
- **The connector**: `mcp.ts` and `tools.ts`, the tools Claude and ChatGPT
  call; `prompts/` and `public/docs/` are what those assistants read.
- **Spending**: `models.ts` and its allowance, the one budget per account
  (M-42105).

## Deploying

A push to main deploys, through Cloudflare Workers Builds (watch paths
`workers/yak/*` and `packages/*`). Nothing gates it; the gate reports. So the
safety is in recovery: `yak admin revert <sha> --admin` reverts a commit and
waits for its deploy, `yak admin rollback --admin` refuses to cross a data
migration boundary, and `deno task verify:yak` checks the doors and tails for
5xx after a deploy. Staging (yaks.fyi) deploys after production from the same
build, so it is a sandbox for billing, not a canary.

## What a Durable Object can't do

- **SQLite limits** (packages/durable-object/testing.ts `LIMITS`): 100 bound
  values, an expression 100 deep, a compound select of 5 arms. Only
  `transactionSync` makes a transaction. A query that works on the box can be
  refused in a store.
- **No clock while code runs.** Time advances only across I/O, so a time
  budget reads 0 ms. Bound work by rows or batches (`mover.ts`).
- **128 MB per isolate**, shared by every object in it (`HELD` in
  packages/embedding/held.ts caps vector copies at 48 MB).
- **Rows read are billed**, and stores collect no planner statistics yet
  (T-61475): a filter that misses the archetype index scans the store.
- **Boot must not fail.** A store whose post-boot pass throws keeps serving and
  retries with backoff (`graph.ts` `#sowing`). Anything that could throw (a
  shape change, a backfill) runs after boot, in slices, behind the store's own
  traffic.

## An app's words

A store's vocabulary is the platform's core documents plus the app's own
`vocab.json` (`vocab.ts` `appVocab`). Today they share one namespace:

- A new manifest may not declare a platform word (`RESERVED`, `unsaid`).
- A word the app held before the platform took it stays the app's in its own
  store (`beneath`).
- So before the platform takes a word, run `deno task app-grep` over every
  app's live files and kept versions. A collision breaks that app's store and
  every door that reads it.

Namespacing (D-59567) is designed, not built. The `vocabulary` skill covers
designing words; the `migrate` skill covers moving stored rows.

## People's things

- **Access fails closed.** A missing or unknown mode reads as private
  (packages/member/words.ts `mode()`), and the directory reports an app row
  with none. A default that opens something is a leak waiting for a stale row.
- **What people hold keeps working**: sign-ins, links, tokens, tickets in an
  inbox (M-37923). A change to how they are made migrates them.
- **Input is precious** (M-59093): a draft, an unsent message or a form is
  never given a short lifetime.
- **Money spends from one budget per account** (M-42105), whatever the
  source. Something new that costs money spends from it rather than adding an
  allowance; embedding calls don't count yet (T-59279).

## The connector

A tool's name, arguments, answer and `outputSchema`, as published in a
directory listing, keep answering until the next listing (M-37853). A rename
serves the old name as a translation. Prompts and examples take the person's
own situation, never an invented one (M-37856). The guide's list of taken words
lives in `public/docs/components.md`, and a test checks it.

## Debugging an app

- `yak admin query <space>/<app> <query> --admin` reads its store.
- `yak admin errors --admin` lists errors by Sentry issue. Sentry runs out of
  events monthly, so an empty answer may mean blind, not healthy, until the
  platform's own tracker lands (D-45640).
- `yak admin tail --admin` follows live events.
- `yak admin throwaway` signs in a test account for probes. `--owner` acts as
  Jeff, only for an act he asked for (M-31958).
- An app's own errors surface through `app_errors` and the unseen block
  (`unseen.ts`).
- Examples to look at live in the `yourname` space (M-37804).

## Tests

Most worker tests run on the deno platform against the in-memory kernel its
process shares (`probe.ts` `kernel`). One that needs a whole kernel takes its
own (`fresh`). A `*_workerd_test.ts` is only for what the runtime alone has,
and shares the run's one workerd (`workerd`). A test on a shared kernel keeps
apart by its own data. The money paths use the Stripe sandbox.

When this skill is wrong or missing something, fix it in the same change.
