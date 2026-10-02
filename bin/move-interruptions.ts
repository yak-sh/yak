// T59065 expansion: keep historical state/diagnostics until every reader moves.
// A copy is the default target. All writes pass through journal/archetype rules.
import { configPath, read } from '../packages/cli/config.ts'
import { words } from '../packages/cli/host.ts'
import { open } from '../packages/sqlite/db.ts'
import { unit } from '../packages/sqlite/unit.ts'
import { storage } from '@yaks/sqlite'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import {
  interruptionContract,
  interruptionContractFind,
  interruptionFind,
  interruptionMove,
} from '../packages/tools/interruptions.ts'
import { indexed, tabled } from '../packages/sqlite/ddl.ts'
import { journal as journalPlugin } from '../packages/journal/mod.ts'
import { logFor } from '../packages/journal/rules.ts'
import { rules as archetypeRules } from '../packages/archetype/rules.ts'
import { rules as blobRules } from '../packages/blob/rules.ts'
import { sqliteBlobs } from '../packages/blob/sqlite.ts'
import {
  and,
  as,
  col,
  count,
  type Derived,
  eq,
  gt,
  join,
  lit,
  notNull,
  select,
  sub,
  table,
} from '@yaks/sql'
let path = Deno.args[0]
if (!path || !path.startsWith('/')) throw new Error('Name an existing database')
await Deno.stat(path)
if (
  path == `${Deno.env.get('HOME')}/.yak/yak.db` && !Deno.args.includes('--live')
) {
  throw new Error('Live database requires --live')
}
let config = read(configPath()!)
let spoken = await words(config)
let sql = open(path)
let report = (stage: string, value: unknown) =>
  console.log(JSON.stringify({ stage, value }))
try {
  // Only the two owned additive changes; never the storage-wide schema fitter.
  let have = (name: string) =>
    sql.query({ t: 'pragma', name: 'table_xinfo', arg: name })
  let stmts = [
    ...tabled(spoken.vocab, spoken.derived),
    ...indexed(spoken.vocab),
  ]
  let admission = stmts.filter((s) =>
    (s.t == 'create table' && s.name == 'interrupted' &&
      !have(s.name).length) ||
    (s.t == 'create index' && s.on == 'interrupted')
  )
  if (!have('attempt').some((c) => c.name == 'by')) {
    admission.push({
      t: 'alter table',
      table: 'attempt',
      add: { name: 'by', type: 'text' },
    })
  }
  report('schema', admission)
  let derived: Derived = { ...spoken.derived }
  for (let name of ['attempt', 'execution']) {
    derived[`${name}.state`] = {
      tag: 'text',
      expr: (owner) =>
        sub(
          select({
            cols: [col('state', 'old')],
            from: table(name, 'old'),
            where: eq(col('entity', 'old'), owner),
          }),
        ),
    }
  }
  if (Deno.args.includes('--apply')) {
    unit(sql, () => admission.forEach((s) => sql.query(s)))
    let g = graph({
      vocab: spoken.vocab,
      storage: storage(sql, spoken.vocab, {
        derived,
        number: config.numbers ?? false,
      }),
      plugins: [
        ...blobRules({ vocab: spoken.vocab, blobs: sqliteBlobs(sql) }),
        ...archetypeRules(),
        journalPlugin(logFor({ sql, derived: spoken.derived })),
      ],
      runs: () => false,
    })
    let contract = Deno.args.includes('--contract')
    let queries = contract ? interruptionContractFind : interruptionFind
    let move = (row: Bundle) =>
      contract ? interruptionContract(row) : interruptionMove(row, sync)
    let sync = (q: string): Bundle[] => {
      let rows = g.read(q)
      if (rows instanceof Promise) throw new Error('Async migration read')
      return rows
    }
    let planned = queries.flatMap((q) => sync(q))
    let bad: string[] = []
    for (let row of planned) {
      try {
        move(row)
      } catch (e) {
        bad.push(String(e))
      }
    }
    report('plan', { candidates: planned.length, failures: bad })
    if (bad.length) throw new Error('Unclassified interruption data')
    let journal = () =>
      Object.fromEntries(
        ['journal_tx', 'journal_change', 'journal_field'].map((name) => [
          name,
          Number(
            sql.query(
              select({ cols: [as(count(), 'n')], from: table(name) }),
            )[0]
              .n,
          ),
        ]),
      )
    let before = journal(), patches = 0, batches = 0
    for (let q of queries) {
      let name = contract && q.startsWith('.attempt')
        ? 'attempt'
        : contract && q.startsWith('.execution')
        ? 'execution'
        : undefined
      let after = 0
      for (;;) {
        let page = name
          ? sql.query(select({
            cols: [as(col('eid', 'e'), 'eid'), as(col('entity', 's'), 'id')],
            from: table(name, 's'),
            joins: [
              join(
                table('entity', 'e'),
                eq(col('id', 'e'), col('entity', 's')),
              ),
            ],
            where: and(
              gt(col('entity', 's'), lit(after)),
              notNull(col('state', 's')),
            ),
            order: [col('entity', 's')],
            limit: lit(1000),
          }))
          : []
        let rows = name
          ? await g.get(page.map((b) => String(b.eid)), [name])
          : sync(q + '&.limit=200')
        if (page.length) after = Number(page.at(-1)!.id)
        if (!rows.length) break
        let changes = rows.flatMap((row) => move(row))
        if (!changes.length) throw new Error('Migration made no progress')
        await g.apply(changes, { trusted: true })
        patches += changes.length
        batches++
        if (batches % 10 == 0) report('progress', { patches, batches })
      }
    }
    report('proof', {
      patches,
      batches,
      before,
      after: journal(),
      remaining: queries.map((q) => sync(q).length),
    })
  }
} finally {
  sql.close()
}
