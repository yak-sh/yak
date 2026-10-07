---
name: data-migration
description: >
  Move stored data from one shape to another without losing any of it or taking
  an app down: on the box (~/.yak/yak.db) or in yaks.app stores. Use whenever a
  change renames, removes, splits or retypes a component or property that has
  rows, rewrites or repairs stored rows, re-derives ids, deletes data in bulk,
  backfills, changes a default or how a missing value reads, writes a one-time
  script, or re-keys anything people hold (links, tokens, saved queries), even
  when the task only says "rename", "clean up", "drop", "purge", "backfill" or
  "fix the old rows". Deciding the new shape is `vocabulary`; how one write or
  query behaves is `graph-reads-and-writes`; how a key or token is kept is
  `secrets-and-connections`; this one is getting the existing data there.
---

# Migrating stored data

You're about to change the shape of something that already has rows. Those
rows are people's: the owner's on the box, everyone's in a yaks.app store, and
everything a person put into them is precious (M-59093). Code can be reverted
and written again; a migration is the one part of a change that can lose
something for good. The persona holds the standing words (M-17876 invariants,
M-17871 one shape, M-37923 what people hold, M-59093 input is precious,
M-37965 recover on its own). This is how they play out when rows move.

It's moving house. The new place has floors before the furniture arrives. The
boxes are counted when they leave and when they land. Nobody keeps the old
house as a second home just in case, and mail sent to the old address still
finds you.

## Where moves go wrong

Keeping the old shape around feels like the safe choice, and it's the
opposite. Two shapes of one thing are a standing source of bugs; the owner
called a half-finished move "like leaving trash all over your house"
(M-17871). So the old shape goes in the same change, with no synonym or
fallback reader left beside the new. What can't be rewritten is shipped code:
a kept version a rollback redeploys, a published release. Those keep speaking
the old form, and the platform translates it at its door rather than a store
holding both. While rows move, the platform keeps nonempty source columns, and
a declared lens serves old callers after the mover contracts them.

Some day a row will be lost, stale or never written, and what the reader makes
of the missing value is the default that counts. Read as the closed side, a
stale row is an inconvenience; read as the open side, it's an exposure or a
loss. An app with no access mode is private, not public (`mode()` in
packages/member/words.ts). A default that opens something, or a short lifetime
that ends someone's data, is waiting for its stale row.

Some of what a store means lives outside it: links, shared URLs, sign-ins,
tokens, saved queries (a board's filter, a wake's condition). Re-deriving an
eid, or renaming a word a saved query names, breaks them silently and far from
the change. What people hold keeps resolving after the move, and a reshaped
credential converts as it's used (M-37923); how the key itself is kept is
`secrets-and-connections`.

The readers that break are the ones nobody saw. grep finds ours.
`deno task app-grep` (bin/app-grep.ts) searches every yaks app's live files
and kept versions, where an app may declare the same component name or query
it; a word the platform takes that an app already holds breaks that app's
store.

And every running process, `yak serve` and the `yak-work@` workers, runs the
code it started with. Rows moved before the code that reads them is live are
rows those processes can no longer find. The move and the code that reads its
result go live together.

So the posture is care without timidity: unhurried about proof, decisive about
letting the old shape go. Rehearse on something you can throw away, count at
both ends, and leave one shape behind.

## On the box (~/.yak/yak.db)

Write through the graph wherever it can say the change: bundles through
`yak graph apply`, or a script that opens the graph (`graph-reads-and-writes`,
"Scripts against the db", has how each behaves). Then stamps, the journal,
archetype pointers and the full-text and vector indexes stay right. Raw SQL
past the graph leaves archetype pointers stale, and filters and whole reads
then answer wrong; where SQL can't be avoided, `reclassify(driver, eids)`
inside its transaction sets them right (packages/sqlite/README.md).

Prove it on a copy first. This copies the pages as one read transaction saw
them, in about five minutes:

```sh
sqlite3 -readonly ~/.yak/yak.db BEGIN "select count(*) from sqlite_schema" \
  ".backup <scratch>/copy.db" COMMIT
```

Without the BEGIN, `.backup` starts over each time another process commits,
which on the box is several times a second; `VACUUM INTO` rebuilds every index
and takes over half an hour on the 10 GB graph. Point a scratch config at the
copy (`end-to-end-checks` has how a probe stays apart from the live graph),
run the script, compare counts before and after, and run it again to show the
second run changes nothing. A script that parses sqlite3's output names its
mode (`-list`, `-json`): a ~/.sqliterc can set `.mode box`, and its borders
then read as data, eids included. A copy is as big as the live file
(`ls -lh ~/.yak/yak.db`) and sits on the disk the live graph writes to. Copies
left behind have filled that disk, so the copy and its scratch config go once
the proof is done.

`bin/backup` puts a snapshot of the box's databases in R2 every night and
keeps the newest seven; `bin/backup restore <new dir>` brings the newest back
(the script's header has the rest). Cron runs it at 04:42, and it takes about
25 minutes under a lock; each run is in ~/.tasks-backup.log, ending
`backup: <night>: <n> entities, done in <s>s`. When one finished recently, it
will do; otherwise run `bin/backup` before the migration.

The live run belongs to the moment the code that reads the new shape goes
live: land, then run the migration and `yak restart` back to back. A change
that drops a column or renames a table is the same, done in that one sitting.

The script is deleted in the next commit. Its commit is the record, and the
message says what moved, with counts.

## On yaks.app stores

A store that throws at boot answers nothing but errors, so rows don't move in
boot. They move with the store mover (workers/yak/mover.ts), from each store's
alarm once it serves, fifty rows to a transaction. workers/yak/README.md,
"Migration passes: expand, then contract", is the reference.

- A mover rule is data: a query for the rows still in the old shape, and the
  patch that moves one. It lands rehearsal-only.
- `yak admin move --rehearse --as admin@bot.yak.sh` moves every rule's rows in
  every store inside a transaction the store rolls back, and reports what each
  store found, moved and failed. A space or `space/app` narrows it.
- A clean rule goes `live: 'apps'`, then `'all'`, the directory last; its mark
  joins `BOUNDARIES` in workers/yak/migrate.ts in that release, so a rollback
  never lands on code that can't read the moved rows.
- A migration a declared lens covers expands while source rows remain, then
  contracts in the mover's final transaction. The store keeps its newest
  vocabulary and immutable lens chain through a code rollback. Kept pages speak
  their deploy's timestamp, so old reads, writes and vocabulary declarations
  translate at the graph doors (packages/lens/README.md).
- Other migrations ship as expand, migrate, contract: the first release reads
  both shapes, the mover moves, and a later release deletes the old reader
  once `yak admin move --as admin@bot.yak.sh` shows every store moved. Each
  release rolls back one step safely.
- A batch that fails unwinds, is reported, and the store keeps serving the
  shape it holds until the next try. That's recovery rather than a gate
  (M-37965). The mover bounds its work in rows, since a Worker's clock stands
  still while code runs (`yaks-app`).
- `store_restore` brings one store back to a moment before, if a move went
  wrong.

The owner's standing word for these, on D-45640 and D-59037, verbatim on the
latter: "and let's ensure that the migrations don't bring down yaks apps".

## Knowing it landed

The counts match what the script said, on the copy and live. A query that read
wrong before the change reads right now. `yak admin errors --as admin@bot.yak.sh`
and the box's logs show nothing new.

When this skill is wrong or missing something, fix it in the same change.
