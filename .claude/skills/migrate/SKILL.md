---
name: migrate
description: >
  Move stored data from one shape to another without losing any of it or taking
  an app down: on the box (~/.yak/yak.db) or in yaks.app stores. Use whenever a
  change renames, removes, splits or retypes a component or property that has
  rows, rewrites or repairs stored rows, re-derives ids, deletes data in bulk,
  backfills, changes a default or how a missing value reads, writes a one-time
  script, or re-keys anything people hold (links, tokens, saved queries), even
  when the task only says "rename", "clean up", "drop", "purge", "backfill" or
  "fix the old rows". Deciding the new shape is the `vocabulary` skill; this one
  is getting the existing data there.
scope: tasks-v2
volatility: stable
---

# Migrating stored data

Stored data is people's: Jeff's on the box, everyone's in a yaks.app store. A
migration is the one change that can lose it for good, so it earns more care
than the code around it. The persona states the rules (M-17876 invariants,
M-17871 one shape, M-37923 what people hold, M-59093 input is precious,
M-37965 recover on its own); this is how to follow them.

## Decide the shape first

- **One shape after.** The old shape is deleted in the same change, never kept
  beside the new as a synonym or a fallback reader. The only exception is the
  platform's expand-then-contract window below, which closes once every store
  has moved.
- **A missing value reads as the safe side.** When a row is lost, stale or
  never written, the reader must fail closed: an app with no access mode is
  private, not public (`mode()` in packages/member/words.ts). A default that
  opens something, or a short lifetime that ends someone's data, is a loss
  waiting for a stale row.
- **What people hold keeps working.** Links, shared URLs, sign-ins, tokens and
  saved queries (a board's filter, a wake's condition) are outside the store.
  If the change re-derives an eid or renames what a saved query names, the old
  form keeps resolving.
- **Find every reader first.** grep the repo for the word, and run
  `deno task app-grep` over every yaks app's live files and kept versions: an
  app may declare the same component name or query it. A word the platform
  takes that an app already holds breaks that app's store.

## On the box (~/.yak/yak.db)

1. **Write through the graph** where it can say the change (bundles through
   `yak graph apply`, or a script that opens the graph), so stamps, the
   journal, archetype pointers, full-text and vector indexes stay right. Raw
   SQL past the graph leaves archetype pointers stale, and filters and whole
   reads then answer wrong. If raw SQL is unavoidable, call
   `reclassify(driver, eids)` inside its transaction (packages/sqlite/README.md).
2. **Prove it on a copy.** `sqlite3 ~/.yak/yak.db "VACUUM INTO '<scratch>/copy.db'"`
   (about three minutes on the live file), point a scratch config at the copy,
   run the script, compare counts before and after, and run it again to show
   it changes nothing the second time.
3. **Back up.** `bin/backup` takes 8 to 20 minutes and holds a lock. If a run
   finished minutes ago, `git -C ~/.yak log -1` shows it and it will do.
4. **Run it live.** Rewriting rows can run with `yak` up. Dropping a column or
   renaming a table needs `systemctl --user stop yak` first and `start` after.
5. **Delete the script** in the next commit. Its commit is the record; say in
   the message what moved, with counts.

## On yaks.app stores

Never in boot: a boot that throws leaves a store answering errors. Rows move
with the store mover (workers/yak/mover.ts; workers/yak/README.md, "Migration
passes: expand, then contract").

- A rule is data: a query for the rows still in the old shape, and the patch
  that moves one. It lands rehearsal-only.
- `yak admin move --rehearse --admin` moves every rule's rows in every store
  inside a transaction that rolls back, and reports what each store found,
  moved and failed.
- A clean rule goes `live: 'apps'`, then `'all'`, the directory last; its mark
  joins `BOUNDARIES` in workers/yak/migrate.ts in that release, so a rollback
  never lands on code that can't read the moved rows.
- Ship it as expand, migrate, contract: the first release reads both shapes,
  the mover moves, and a later release deletes the old reader once
  `yak admin move --admin` shows every store moved. Each release rolls back one
  step safely.
- A batch that fails unwinds, is reported, and the store keeps serving the shape
  it holds; the next deploy tries again. Bound work by rows, never by time:
  inside a Worker the clock does not move while code runs.
- `store_restore` brings one store back if a move went wrong.

Jeff's standing word for these, on D-45640 and D-59037: migrations must not
bring down yaks apps.

## Before calling it done

- Counts before and after, on the copy and live, match what the script said.
- A query that read wrong before the change now reads right.
- `yak admin errors --admin` and the box's logs show nothing new.

When this skill is wrong or missing something, fix it in the same change.
