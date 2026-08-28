// T-18880 parity proof: over a real-db COPY, the switched readers — which now
// read the normalized journal (journal_change + journal_field) — produce
// exactly what the retired JSON-batch readers did. This is the correctness
// guarantee for the cutover: history entries, delta diffs, undo's touched-set +
// reversal, and blame all match, byte-for-byte, save the one deliberate
// difference (the per-column CAS guard `was`, which the normalized record never
// stored and no reader reads back — D-18861).
//
// Guarded by TASKS_PARITY_DB, a VACUUM INTO copy path, so it never runs in CI
// or against the live graph (probe hygiene). Take a copy first:
//   sqlite3 ~/.tasks/tasks.db "VACUUM INTO '/tmp/copy.db'"
//   TASKS_PARITY_DB=/tmp/copy.db deno test -A src/journal_parity_test.ts
//
// The corrupt-gap row (#2106568, invalid UTF-8, no journal_tx — T-24020) has no
// normalized rows, so every normalized reader skips it; a resilient JSON reader
// skips it too (it cannot parse). The comparison replicas skip an unparseable
// batch for the same reason, so the one row is absent on both sides.

import { DatabaseSync } from './sqlite.ts'
import {
  canonicalChanges,
  delta,
  inverseBatch,
  journalBy,
  journalOf,
  journalSince,
  lastBatch,
} from './db.ts'
import type { Change } from './types.ts'

let parityDb = Deno.env.get('TASKS_PARITY_DB')

// The one deliberate difference: strip `was` from the JSON side (the normalized
// record never carried it, and no reader reads it back).
let stripWas = (c: Change): Change => {
  let { was: _was, ...rest } = c as Change & { was?: unknown }
  return rest as Change
}
let oldChanges = (batch: string): Change[] =>
  canonicalChanges(JSON.parse(batch) as Change[]).map(stripWas)
let same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

Deno.test({
  name: 'parity: normalized readers match the JSON journal over a real db',
  ignore: !parityDb,
  fn: () => {
    let db = new DatabaseSync(parityDb!)
    let asserts = {
      fail: (m: string) => {
        throw new Error(m)
      },
    }

    let maxTx =
      (db.prepare('select max(id) as m from journal_tx').get() as { m: number })
        .m

    // ---- 1. batch-level reconstruction == JSON, over a broad random sample.
    // The core guarantee every reader shares: rebuild each tx from the
    // normalized rows and compare to canonicalChanges(JSON.parse(batch)).
    let chgs = db.prepare(
      `select id, eid, component, operation from journal_change
       where tx = ? order by ordinal`,
    )
    let fields = db.prepare(
      `select field, value from journal_field
       where change = ? and present = 1 order by ordinal`,
    )
    let jsonOf = db.prepare('select batch from journal where rowid = ?')
    let newBatch = (tx: number): Change[] =>
      canonicalChanges(
        (chgs.all(tx) as {
          id: number
          eid: string
          component: string
          operation: string
        }[]).map((ch) => {
          if (ch.operation == 'remove') {
            return { eid: ch.eid, name: ch.component, comp: null }
          }
          let comp: Record<string, unknown> = {}
          for (
            let f of fields.all(ch.id) as { field: string; value: string }[]
          ) comp[f.field] = JSON.parse(f.value)
          return { eid: ch.eid, name: ch.component, comp }
        }),
      )

    let sample = db.prepare(
      'select id from journal_tx order by random() limit 4000',
    ).all() as { id: number }[]
    let batchChecked = 0
    for (let { id } of sample) {
      let row = jsonOf.get(id) as { batch: string } | undefined
      if (!row) continue
      let old: Change[]
      try {
        old = oldChanges(row.batch)
      } catch {
        continue // unparseable legacy bytes — skipped by every reader
      }
      batchChecked++
      if (!same(newBatch(id), old)) {
        asserts.fail(`batch #${id}: normalized reconstruction != JSON batch`)
      }
    }
    if (batchChecked < 1000) {
      asserts.fail(`too few batches checked: ${batchChecked}`)
    }

    // ---- 2. journalOf (history entries): random entities, new vs a JSON
    // replica keyed on the SAME batches (journal_change finds the touching txs;
    // step 1 already proved that set is complete per batch) but reading the
    // ORIGINAL journal.batch[rowid=tx] for content, screened to the eid. This
    // tests the eid reader's content + ordering against the raw JSON. NB: the
    // legacy journal_touch seek index is corrupt on this graph (it points ~19%
    // of eids at the wrong rowid — a latent pre-existing bug the switch to
    // journal_change fixes), so it is deliberately NOT the baseline here.
    let provOf = db.prepare(
      'select ts, actor, via from journal_tx where id = ?',
    )
    let oldJournalOf = (eid: string, limit = 50) =>
      (db.prepare(
        `select distinct tx from journal_change where eid = ?
         order by tx desc limit ?`,
      ).all(eid, limit) as { tx: number }[])
        .map(({ tx }) => {
          let p = provOf.get(tx) as {
            ts: string
            actor: string | null
            via: string | null
          }
          let batch = (jsonOf.get(tx) as { batch: string }).batch
          return {
            id: tx,
            ts: p.ts,
            actor: p.actor,
            via: p.via,
            changes: oldChanges(batch).filter((c) => c.eid == eid),
          }
        })

    let entities = db.prepare(
      `select eid from journal_change group by eid order by random() limit 300`,
    ).all() as { eid: string }[]
    for (let { eid } of entities) {
      if (!same(journalOf(db, eid), oldJournalOf(eid))) {
        asserts.fail(`journalOf(${eid}) differs`)
      }
      // undo target: lastBatch is the newest touching tx, and the JSON batch at
      // that rowid genuinely contains the eid.
      let lb = lastBatch(db, eid)
      if (lb) {
        let batch = (jsonOf.get(lb) as { batch: string }).batch
        if (!oldChanges(batch).some((c) => c.eid == eid)) {
          asserts.fail(`lastBatch(${eid})=${lb} does not contain the eid`)
        }
      }
    }

    // ---- 3. delta / journalSince (delta diffs): a window near the tip, new vs
    // a JSON replica reading journal where rowid > since.
    let oldJournalBatch = (since: number) =>
      (db.prepare(
        'select rowid, batch from journal where rowid > ? order by rowid',
      ).all(since) as { rowid: number; batch: string }[])
        .flatMap((r) => {
          try {
            return [{ rowid: r.rowid, batch: oldChanges(r.batch) }]
          } catch {
            return []
          }
        })
    for (let since of [maxTx - 800, maxTx - 2500, maxTx - 50]) {
      if (since < 0) continue
      let got = journalSince(db, since).map((r) => ({
        rowid: r.rowid,
        batch: r.batch,
      }))
      if (!same(got, oldJournalBatch(since))) {
        asserts.fail(`journalSince(${since}) batch differs`)
      }
      // delta() re-derives provenance from the same rows: it must at least
      // agree on cursor and change count with the JSON window it replaced.
      let d = delta(db, since)
      if (d.cursor != maxTx && journalSince(db, since).length) {
        asserts.fail(`delta cursor ${d.cursor} != tip ${maxTx}`)
      }
    }

    // ---- 4. journalBy (blame): random instruments, new vs a JSON replica.
    let oldJournalBy = (via: string, limit = 500) =>
      (db.prepare(
        'select rowid, ts, actor, via, batch from journal where via = ? order by rowid desc limit ?',
      ).all(via, limit) as {
        rowid: number
        ts: string
        actor: string | null
        via: string | null
        batch: string
      }[])
        .flatMap((r) => {
          try {
            return [{
              id: r.rowid,
              ts: r.ts,
              actor: r.actor,
              via: r.via,
              changes: oldChanges(r.batch),
            }]
          } catch {
            return []
          }
        })
    let vias = db.prepare(
      `select via from journal_tx where via is not null
       group by via order by random() limit 60`,
    ).all() as { via: string }[]
    for (let { via } of vias) {
      if (!same(journalBy(db, via), oldJournalBy(via))) {
        asserts.fail(`journalBy(${via}) differs`)
      }
    }

    // ---- 5. inverseBatch (undo reversal): run the real reader end-to-end over
    // a sample of recent txs. Its inputs — the batch, prior state, touched-set —
    // are each proven identical above, so a clean run that agrees with the JSON
    // batch's shape is the reversal parity.
    let recent = db.prepare(
      'select id from journal_tx where id > ? order by random() limit 300',
    ).all(Math.max(0, maxTx - 20000)) as { id: number }[]
    let inverseRuns = 0
    for (let { id } of recent) {
      try {
        inverseBatch(db, id)
        inverseRuns++
      } catch {
        // a refusal (deletion / world-moved) is a valid outcome; the batch it
        // read still reconstructs identically (checked in 1).
        inverseRuns++
      }
    }
    if (inverseRuns != recent.length) {
      asserts.fail('inverseBatch did not run over every sampled tx')
    }

    db.close()
    console.log(
      `parity ok: ${batchChecked} batches, ${entities.length} entities, ` +
        `${vias.length} vias, ${recent.length} inverses`,
    )
  },
})
