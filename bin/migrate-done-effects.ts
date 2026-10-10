#!/usr/bin/env -S deno run -A
// One-time T-121598: delete legacy done effect runs through the pool's success
// path: guarded graph.apply({ $delete: true }, { trusted: true }). Each run
// becomes a tombstone, retaining its entity identity but no effect component.
// Pending and failed runs are never selected. Each batch owns a short file
// transaction; refused batches remain for a rerun while later batches proceed.
//
// After backup, from this checkout:
//   deno run -A bin/migrate-done-effects.ts /absolute/database.db [batch-size]
// Defaults to 100 runs per batch. Reads the normal CLI config for vocabulary
// only; opens only the database argument, and never installs/refits its schema.
// Prints counts and batch/total milliseconds. A nonzero remaining done count
// sets exit status 1; rerun the same command to pick up whatever remains.
import {
  type Access,
  type Bundle,
  type Comp,
  Refused,
  Stale,
  token,
} from '@yaks/graph'
import {
  and,
  col,
  type Driver,
  eq,
  gt,
  join,
  select,
  table,
  tally,
  val,
} from '@yaks/sql'

/** Match successful pool settlement, also guarding the selected done state. */
export let deletion = (row: Bundle): Bundle[] => {
  let effect = row.effect as Comp | undefined
  if (effect?.state != 'done') return []
  return [{
    entity: { eid: row.entity.eid },
    $delete: true,
    $was: {
      effect: {
        state: token('done'),
        lease_token: token(effect.lease_token ?? null),
        attempts: token(effect.attempts ?? null),
      },
    },
  }]
}

let counts = (sql: Driver) =>
  Object.fromEntries(
    ['done', 'pending', 'failed'].map((state) => [
      state,
      tally(sql, 'effect', eq(col('state'), val(state))),
    ]),
  )

type Report = (event: string, values: Record<string, unknown>) => void

export let migrateDone = async (
  sql: Driver,
  g: Access,
  batch = 100,
  report: Report = (event, values) =>
    console.log(JSON.stringify({ event, ...values })),
) => {
  if (!Number.isSafeInteger(batch) || batch < 1) {
    throw Error('positive integer batch size required')
  }
  let started = performance.now()
  let before = counts(sql)
  report('before', before)
  let cursor = 0
  let batches = 0
  let deleted = 0
  let refused = 0
  while (true) {
    let began = performance.now()
    // Numeric component PK ordering keeps the scan bounded, including after
    // refusal: a poison row must not repeatedly occupy the first batch.
    let page = sql.query(select({
      cols: [col('entity', 'effect'), col('eid', 'entity')],
      from: table('effect'),
      joins: [
        join(table('entity'), eq(col('id', 'entity'), col('entity', 'effect'))),
      ],
      where: and(
        eq(col('state', 'effect'), val('done')),
        gt(col('entity', 'effect'), val(cursor)),
      ),
      order: [col('entity', 'effect')],
      limit: val(batch),
    }))
    if (!page.length) break
    cursor = Number(page.at(-1)!.entity)
    let rows = await g.get(page.map((r) => String(r.eid)), ['effect'])
    let patches = rows.flatMap(deletion)
    let error: string | undefined
    if (patches.length) {
      try {
        await g.apply(patches, { trusted: true })
        deleted += patches.length
      } catch (e) {
        if (
          !(e instanceof Stale || e instanceof Refused ||
            e instanceof Error && 'retryable' in e && e.retryable === true)
        ) throw e
        refused++
        error = e.message
      }
    }
    report('batch', {
      batch: ++batches,
      selected: page.length,
      deleted: error ? 0 : patches.length,
      ms: Math.round(performance.now() - began),
      ...error ? { refused: error } : {},
    })
  }
  let after = counts(sql)
  let result = {
    before,
    after,
    deleted,
    batches,
    refused,
    ms: Math.round(performance.now() - started),
  }
  report('complete', result)
  return result
}

let main = async () => {
  let [path, size] = Deno.args
  if (!path || Deno.args.length > 2 || path == ':memory:') {
    throw Error(
      'usage: deno run -A bin/migrate-done-effects.ts /absolute/database.db [batch-size]',
    )
  }
  let batch = size == null ? 100 : Number(size)
  if (!Number.isSafeInteger(batch) || batch < 1) {
    throw Error('positive integer batch size required')
  }
  let target = await Deno.realPath(path)
  if (!(await Deno.stat(target)).isFile) {
    throw Error('existing database file required')
  }
  let { configPath, read } = await import('../packages/cli/config.ts')
  let { words } = await import('@yaks/cli/host')
  let configFile = configPath()
  if (!configFile) {
    throw Error('CLI configuration required for complete vocabulary')
  }
  let config = { ...read(configFile), db: target }
  let loaded = await words(config)
  let { open } = await import('@yaks/sqlite/db')
  let { schema, storage } = await import('@yaks/sqlite')
  let { graph } = await import('@yaks/graph')
  let { archetypes } = await import('@yaks/archetype')
  let { journal, log } = await import('@yaks/journal')
  let sql = open(target)
  try {
    // Check declarations without installing them or retiring standing words.
    for (let statement of schema(loaded.vocab, loaded.derived)) {
      if (statement.t != 'create table' || statement.name == '_meta') continue
      let columns = sql.query({
        t: 'pragma',
        name: 'table_info',
        arg: statement.name,
      })
      let held = new Set(columns.map((c) => String(c.name)))
      if (!columns.length || statement.cols.some((c) => !held.has(c.name))) {
        throw Error(
          `database lacks declared table ${statement.name}; no deletion performed`,
        )
      }
    }
    // Keep file ownership: graph.apply takes BEGIN IMMEDIATE for its own
    // batch, checks $was under that lock, then commits/releases it promptly.
    let db = storage(sql, loaded.vocab, {
      derived: loaded.derived,
      backed: loaded.backed,
      schemaReady: () => true,
      number: config.numbers,
    })
    let g = graph({
      storage: db,
      vocab: loaded.vocab,
      plugins: [
        archetypes(),
        journal(
          log({ rows: (s) => sql.query(s), derived: loaded.derived }),
          loaded.vocab,
        ),
      ],
    })
    let result = await migrateDone(sql, g, batch)
    if (result.after.done) Deno.exitCode = 1
  } finally {
    sql.close()
  }
}

if (import.meta.main) await main()
