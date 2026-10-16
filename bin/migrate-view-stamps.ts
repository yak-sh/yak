// One-time provenance repair. Default is genuinely read-only. Explicit config
// and db required; no config discovery, schema install, duties or process row.
// --config PATH --db PATH [--mode dry-run|apply]
// Apply uses the composed vocabulary but NEVER installs its schema on the file:
// even an explicit reduced config must not retire unrelated live components.
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { open } from '../packages/sqlite/db.ts'
import { storage } from '@yaks/sqlite'
import { type Bundle, graph, token } from '@yaks/graph'
import { archetypes } from '@yaks/archetype'
import { journal, log } from '@yaks/journal'
import {
  among,
  col,
  type Driver,
  lit,
  type Row,
  select,
  table,
} from '@yaks/sql'
import {
  type Candidate,
  decide,
  type Event,
  type Stamp,
} from './migrate-view-stamps-plan.ts'

let rows = (
  db: Driver,
  name: string,
  ids?: number[],
  field = 'entity',
): Row[] =>
  db.query(
    select({
      from: table(name),
      ...(ids ? { where: among(col(field), ids.map(lit)) } : {}),
    }),
  )
let stamp = (r: Row | undefined, eids: Map<number, string>): Stamp | null =>
  r
    ? {
      at: r.at == null ? null : String(r.at),
      by: r.by == null ? null : eids.get(Number(r.by)) ?? (() => {
        throw Error('Unresolved provenance by')
      })(),
      via: r.via == null ? null : eids.get(Number(r.via)) ?? (() => {
        throw Error('Unresolved provenance via')
      })(),
    }
    : null
// Bounded entity seeks, never a full journal materialization. A transaction is
// classified per ENTITY: another entity's edits must not legitimize this view.
export let inventory = (db: Driver): Candidate[] => {
  let opened = rows(db, 'opened')
  let answer: Candidate[] = []
  for (let offset = 0; offset < opened.length; offset += 100) {
    let batch = opened.slice(offset, offset + 100)
    let ids = batch.map((r) => Number(r.entity))
    let changes = rows(db, 'journal_change', ids)
    let txids = [...new Set(changes.map((r) => Number(r.tx)))]
    let txs: Row[] = []
    for (let i = 0; i < txids.length; i += 500) {
      txs.push(...rows(db, 'journal_tx', txids.slice(i, i + 500), 'id'))
    }
    let created = rows(db, 'created', ids), updated = rows(db, 'updated', ids)
    let references = [
      ...new Set([
        ...ids,
        ...[...created, ...updated, ...batch, ...txs].flatMap((r) =>
          [r.by, r.via, r.actor].filter((x) => x != null).map(Number)
        ),
      ]),
    ]
    let eids = new Map<number, string>()
    for (let i = 0; i < references.length; i += 500) {
      for (let r of rows(db, 'entity', references.slice(i, i + 500), 'id')) {
        eids.set(Number(r.id), String(r.eid))
      }
    }
    let txmap = new Map(txs.map((r) => [Number(r.id), r]))
    for (let o of batch) {
      let id = Number(o.entity), events = new Map<number, Event>()
      for (let c of changes.filter((c) => Number(c.entity) == id)) {
        let tx = Number(c.tx), t = txmap.get(tx)!
        if (!events.has(tx)) {
          events.set(tx, {
            tx,
            at: String(t.ts),
            by: t.actor == null ? null : eids.get(Number(t.actor))!,
            via: t.via == null ? null : eids.get(Number(t.via))!,
            changes: [],
          })
        }
        events.get(tx)!.changes.push({
          component: String(c.component),
          operation: String(c.operation),
        })
      }
      answer.push({
        eid: eids.get(id)!,
        opened: stamp(o, eids),
        created: stamp(created.find((r) => Number(r.entity) == id), eids),
        updated: stamp(updated.find((r) => Number(r.entity) == id), eids),
        events: [...events.values()],
      })
    }
  }
  return answer
}
export let patch = (
  eid: string,
  before: Stamp,
  after: Stamp | null,
): Bundle => ({
  entity: { eid },
  $was: {
    updated: {
      at: token(before.at),
      by: token(before.by),
      via: token(before.via),
    },
  },
  updated: after,
})
let main = async () => {
  let opts: Record<string, string> = { mode: 'dry-run' }
  for (let i = 0; i < Deno.args.length; i += 2) {
    let k = Deno.args[i], v = Deno.args[i + 1]
    if (
      !['--config', '--db', '--mode'].includes(k) || !v || v.startsWith('--')
    ) throw Error('Expected --config PATH --db PATH [--mode dry-run|apply]')
    opts[k.slice(2)] = v
  }
  if (!opts.config || !opts.db || !['dry-run', 'apply'].includes(opts.mode)) {
    throw Error('Explicit --config, --db and valid mode required')
  }
  let dbpath = await Deno.realPath(opts.db)
  let config = read(opts.config)
  if (!config.db || await Deno.realPath(config.db) != dbpath) {
    throw Error('--db must match explicit config db')
  }
  // Load vocabulary only: no service, tool or domain graph factories. Schema
  // and apply plugins below are deliberately explicit and have no side effects.
  let plugins = (config.plugins ?? []).map((p) =>
    typeof p == 'string'
      ? { use: p, facets: ['vocab'] as ['vocab'] }
      : { ...p, facets: ['vocab'] as ['vocab'] }
  )
  let host = await compose(
    { db: dbpath, plugins },
    ['graph'],
    undefined,
    { process: false, readOnly: true },
  )
  let db = open(dbpath, { readOnly: true })
  try {
    let candidates = inventory(db)
    let decisions = candidates.map(decide)
    let repairs = decisions.filter((d) => d.status == 'repair')
    console.log(JSON.stringify(
      {
        mode: opts.mode,
        db: dbpath,
        opened: candidates.length,
        repair: repairs.length,
        preserve: decisions.filter((d) => d.status == 'preserve').length,
        ambiguous: decisions.filter((d) => d.status == 'ambiguous').length,
        warning:
          'source journal ts approximates stamp at; original exact at is not journaled',
        decisions: decisions.filter((d) => d.status != 'preserve'),
      },
      null,
      2,
    ))
    if (opts.mode == 'dry-run') return
    db.close()
    db = open(dbpath)
    // No install(): normal graph guards, reclassification and journal hooks,
    // without running boot migration/schema code against an incomplete config.
    let store = storage(db, host.vocab, { derived: host.derived })
    let g = graph({
      storage: store,
      vocab: host.vocab,
      plugins: [
        archetypes(),
        journal(
          log({ rows: (s) => db.query(s), derived: host.derived }),
          host.vocab,
        ),
      ],
    })
    let moved = 0
    store.tx(() => {
      let fresh = new Map(inventory(db).map((x) => [x.eid, x]))
      let patches: Bundle[] = []
      for (let d of repairs) {
        let now = fresh.has(d.eid) && decide(fresh.get(d.eid)!)
        if (
          !now || now.status != 'repair' ||
          now.pollutedTx != d.pollutedTx || now.sourceTx != d.sourceTx ||
          JSON.stringify(now.before) != JSON.stringify(d.before) ||
          JSON.stringify(now.after) != JSON.stringify(d.after)
        ) {
          throw Error(`Concurrent history changed: ${d.eid}`)
        }
        patches.push(patch(d.eid, d.before!, d.after!))
      }
      if (patches.length) {
        let result = g.apply(patches, { trusted: true, stamp: false })
        if (result instanceof Promise) {
          throw Error('Expected synchronous SQLite apply')
        }
      }
      moved = patches.length
    })
    console.log(
      JSON.stringify({
        moved,
        remainingRepairs: inventory(db).map(decide).filter((d) =>
          d.status == 'repair'
        ).length,
      }),
    )
  } finally {
    db.close()
    await host.close()
  }
}
if (import.meta.main) await main()
