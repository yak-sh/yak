#!/usr/bin/env -S deno run -A
// Backfill the existing JSON journal history into the normalized journal tables
// (T-18879). A thin operator door over db.ts `backfillJournal`, which owns the
// derivation (shared with the live dual-write) and the restartable, idempotent
// high-water-mark bookkeeping — this script only opens a graph, drives the
// backfill in chunks, and reports progress.
//
// The graph path is EXPLICIT on purpose: pass it as `--db <path>` (or a bare
// positional), or set DB_PATH. There is no default, so this can never open the
// live graph by accident — verify against a COPY first, then the owner runs it
// against the live graph deliberately. Safe to interrupt and re-run: it resumes
// from where it left off and never double-writes.
//
//   deno run -A bin/backfill-journal.ts --db /path/to/copy.db
//   DB_PATH=/path/to/copy.db deno run -A bin/backfill-journal.ts
//   deno run -A bin/backfill-journal.ts --db copy.db --chunk 5000

import { backfillJournal, open } from '../src/db.ts'

let args = Deno.args
let flag = (name: string): string | undefined => {
  let i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
let positional = args.find((a) => !a.startsWith('--'))
let path = flag('--db') ?? Deno.env.get('DB_PATH') ?? positional
if (!path) {
  console.error(
    'usage: backfill-journal.ts --db <path>   (or set DB_PATH)\n' +
      'refusing to run without an explicit graph path — verify on a COPY first.',
  )
  Deno.exit(2)
}
let chunk = Number(flag('--chunk') ?? '2000')

let db = open(path)
let count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n

let journalRows = count('select count(*) as n from journal')
console.error(
  `backfilling ${journalRows} JSON journal rows from ${path} (chunk ${chunk}) …`,
)
let started = performance.now()
let { wrote, skipped } = backfillJournal(db, {
  chunk,
  onChunk: (upto, w, s) =>
    console.error(
      `  … rowid ${upto}/${journalRows}  (${w} written, ${s} skipped)`,
    ),
})
let secs = ((performance.now() - started) / 1000).toFixed(1)

console.error(
  `done: wrote ${wrote} legacy rows in ${secs}s` +
    (skipped ? `, SKIPPED ${skipped} unparseable (corrupt) rows` : '') + '.\n' +
    `  journal_tx    ${count('select count(*) as n from journal_tx')}\n` +
    `  journal_change ${count('select count(*) as n from journal_change')}\n` +
    `  journal_field  ${count('select count(*) as n from journal_field')}`,
)
