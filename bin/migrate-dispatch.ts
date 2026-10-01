// One-time, copy-only BOX dispatch expansion. Never compose a host or install
// its schema: an incomplete vocabulary must not retire somebody else's words.
// Dry-run and rehearsal open a temporary duplicate RW, not a read-only connection.
//
// HARNESS_HOME and TASKS_HOME must be existing scratch directories. Example:
// HARNESS_HOME=/tmp/dispatch-harness TASKS_HOME=/tmp/dispatch-tasks \
//   deno run -A bin/migrate-dispatch.ts \
//   --db /tmp/t59129-proof.IRXjON/copy.db [--mode dry-run|rehearsal|apply]
// --config defaults through the CLI's normal discovery. --vocab may be repeated
// with complete snapshot vocabulary documents when the host words cannot prove
// the snapshot. Neither configuration credentials nor its database are printed.
import { configPath, read as readConfig } from '../packages/cli/config.ts'
import { words } from '../packages/cli/host.ts'
import { graph } from '@yaks/graph'
import { archetypes } from '@yaks/archetype'
import { ddl as journalDdl, journal, log } from '@yaks/journal'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { columns, objects, schema, storage } from '@yaks/sqlite'
import { open } from '../packages/sqlite/db.ts'
import {
  col,
  type Driver,
  fn,
  gt,
  lit,
  render,
  type Row,
  select,
  star,
  type Stmt,
  table,
} from '@yaks/sql'
import { dispatchMove } from '../workers/yak/mover.ts'

let AUTHORIZED = '/tmp/t59129-proof.IRXjON/copy.db'
let FIND = '.dispatch.state=queued,active,waiting,settled&*'
let MARKS = new Set(['admitted', 'waiting'])
let JOURNAL = ['journal_tx', 'journal_change', 'journal_field']
let began = performance.now()
let say = (event: string, value: unknown) =>
  console.log(
    JSON.stringify({ event, ms: Math.round(performance.now() - began), value }),
  )
let fail = (message: string): never => {
  throw new Error(message)
}
let assert = (holds: unknown, message: string) => holds || fail(message)
let sync = <T>(value: T | Promise<T>): T => {
  assert(
    !(value instanceof Promise),
    'Asynchronous graph operation cannot be rehearsed in a SQLite transaction',
  )
  return value as T
}
let options = () => {
  let out = {
    db: '',
    config: undefined as string | undefined,
    mode: 'dry-run',
    vocab: [] as string[],
  }
  for (let i = 0; i < Deno.args.length; i += 2) {
    let key = Deno.args[i]
    let value = Deno.args[i + 1]
    assert(value && !value.startsWith('--'), `Missing value for ${key}`)
    if (key == '--db') out.db = value
    else if (key == '--config') out.config = value
    else if (key == '--mode') out.mode = value
    else if (key == '--vocab') out.vocab.push(value)
    else fail(`Unknown option ${key}`)
  }
  assert(out.db, 'An explicit --db is mandatory')
  assert(['dry-run', 'rehearsal', 'apply'].includes(out.mode), 'Unknown mode')
  return out
}
let scratch = async (name: string) => {
  let path = Deno.env.get(name)
  assert(path, `${name} must name an existing scratch directory`)
  let real = await Deno.realPath(path!)
  assert(
    real.startsWith('/tmp/') && (await Deno.stat(real)).isDirectory,
    `${name} must be a directory below /tmp`,
  )
  return real
}
// Fail closed even on formatting differences. Never normalize inside SQL text:
// whitespace and punctuation can be meaningful in literals and constraints.
export let matchingDdl = (existing: string, declared: string): boolean =>
  existing.trim() == declared.trim()
let identity = (stmt: Stmt): { name: string; type: string } | undefined => {
  if (stmt.t == 'create table') return { name: stmt.name, type: 'table' }
  if (stmt.t == 'create index') return { name: stmt.name, type: 'index' }
  if (stmt.t == 'create view') return { name: stmt.name, type: 'view' }
  if (stmt.t == 'create trigger') return { name: stmt.name, type: 'trigger' }
}
let count = (db: Driver, name: string) =>
  Number(
    db.query(select({
      cols: [fn('count', star())],
      from: table(name),
    }))[0]['count(*)'],
  )
let counts = (db: Driver, inventory: Row[]) =>
  Object.fromEntries(
    inventory
      .filter((r) => r.type == 'table' && !String(r.name).startsWith('sqlite_'))
      .map((r) => [String(r.name), count(db, String(r.name))]),
  )
let indexes = (inventory: Row[]) => inventory.filter((r) => r.type == 'index')
let integrity = (db: Driver) => {
  let result = db.query({ t: 'pragma', name: 'integrity_check' })
  assert(
    result.length == 1 && Object.values(result[0])[0] == 'ok',
    'SQLite integrity_check failed',
  )
  let foreign = db.query({ t: 'pragma', name: 'foreign_key_check' })
  assert(
    !foreign.length,
    `foreign_key_check returned ${foreign.length} failures`,
  )
  return { integrity: result, foreignKeyFailures: foreign.length }
}
let same = (a: unknown, b: unknown) => JSON.stringify(a) == JSON.stringify(b)
// Hash each pre-existing journal prefix in bounded pages. Compare it again
// after migration; counts alone would not prove append-only preservation.
let journalSnapshot = async (db: Driver, ends?: Record<string, number>) => {
  let result: Record<string, { end: number; rows: number; hash: string }> = {}
  for (let name of JOURNAL) {
    let end = ends?.[name] ?? Number(
      db.query(select({
        cols: [fn('max', col('id'))],
        from: table(name),
      }))[0]['max(id)'] ?? 0,
    )
    let after = 0
    let rows = 0
    let hash = ''
    while (after < end) {
      let page = db.query(select({
        from: table(name),
        where: gt(col('id'), lit(after)),
        order: [col('id')],
        limit: lit(1000),
      })).filter((r) => Number(r.id) <= end)
      if (!page.length) break
      rows += page.length
      after = Number(page.at(-1)!.id)
      let bytes = new TextEncoder().encode(hash + JSON.stringify(page))
      hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      )
        .map((b) => b.toString(16).padStart(2, '0')).join('')
    }
    result[name] = { end, rows, hash }
  }
  return result
}
let run = async () => {
  let opts = options()
  await scratch('HARNESS_HOME')
  await scratch('TASKS_HOME')
  let source = await Deno.realPath(opts.db)
  assert(
    source == AUTHORIZED,
    `Only the authorized VACUUM copy is allowed: ${AUTHORIZED}`,
  )
  assert((await Deno.stat(source)).isFile, 'Source is not a regular file')
  // Copying a database with a live WAL would not be a coherent snapshot.
  for (let suffix of ['-wal', '-journal']) {
    try {
      assert(
        (await Deno.stat(source + suffix)).size == 0,
        `Nonempty ${suffix} beside source; stop`,
      )
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    }
  }
  let config = configPath(opts.config)
  assert(
    config,
    'No CLI configuration found; provide --config with complete host vocabulary',
  )
  let loaded = await words({
    ...readConfig(config!),
    db: source,
    duties: false,
  })
  let docs = opts.vocab.length
    ? await Promise.all(
      opts.vocab.map(async (path) =>
        JSON.parse(await Deno.readTextFile(path)) as VocabDoc
      ),
    )
    : loaded.docs
  let vocab = opts.vocab.length
    ? loadVocab(docs, loaded.vocab.keywords)
    : loaded.vocab
  assert(
    vocab.prop('dispatch', 'state'),
    'Full vocabulary must retain legacy dispatch.state for old writers',
  )
  assert(vocab.comp('archetype'), 'Full vocabulary must include archetypes')
  for (let mark of MARKS) {
    assert(vocab.comp(mark), `Full vocabulary lacks ${mark}`)
  }
  // No service/rule/tool factory is called. Config's db is never opened.
  say('configuration', {
    config,
    vocabDocuments: docs.length,
    vocabulary: vocab.all,
    mode: opts.mode,
  })
  let temp = opts.mode != 'apply'
    ? await Deno.makeTempDir({ prefix: 'dispatch-rehearsal-' })
    : undefined
  let target = temp ? `${temp}/copy.db` : source
  let db: ReturnType<typeof open> | undefined
  try {
    if (temp) {
      say('copy-start', {
        source,
        target,
        connection:
          'temporary duplicate opened read-write; source not opened by SQLite',
      })
      await Deno.copyFile(source, target)
      say('copy-complete', { bytes: (await Deno.stat(target)).size })
    } else {say('connection', {
        target,
        connection: 'authorized copy opened read-write',
      })}
    db = open(target)
    let before = objects(db)
    let planned = [...schema(vocab, loaded.derived), ...journalDdl()]
    let expected = new Map(planned.flatMap((stmt) => {
      let key = identity(stmt)
      return key
        ? [[key.name, { ...key, stmt, sql: render(stmt).sql }] as const]
        : []
    }))
    let found = new Map(before.map((r) => [String(r.name), r]))
    let blockers: string[] = []
    let additions: Stmt[] = []
    for (let row of before) {
      let name = String(row.name)
      if (name.startsWith('sqlite_')) continue
      let want = expected.get(name)
      if (!want) {
        blockers.push(`Unaccounted ${row.type} ${name} on ${row.tbl_name}`)
        continue
      }
      if (row.type != want.type) blockers.push(`Object type mismatch ${name}`)
      if (want.stmt.t == 'create table') {
        let actual = columns(db, name).sort()
        let declared = want.stmt.cols.map((c) => c.name).sort()
        if (!same(actual, declared)) {
          blockers.push(
            `Columns ${name}: existing=${JSON.stringify(actual)} declared=${
              JSON.stringify(declared)
            }`,
          )
        }
      }
      if (!matchingDdl(String(row.sql), want.sql)) {
        blockers.push(`DDL differs: ${name}`)
      }
    }
    for (let [name, want] of expected) {
      if (found.has(name)) continue
      let mark = want.stmt.t == 'create table'
        ? want.stmt.name
        : want.stmt.t == 'create index'
        ? want.stmt.on
        : undefined
      if (mark && MARKS.has(mark)) additions.push(want.stmt)
      else {blockers.push(
          `Missing existing ${want.type} ${name}; only admitted/waiting additions permitted`,
        )}
    }
    say('full-schema-comparison', {
      objects: before.length,
      indexes: indexes(before),
      additions: additions.map(identity),
      blockers,
    })
    if (blockers.length) {
      fail(
        'Full snapshot vocabulary/schema provenance not proven. Supply complete --vocab documents (and account for extension DDL in this guard); no install or migration performed',
      )
    }
    // Never call storage.install(): no refit, retirement, backfill, ANALYZE,
    // schema marker rewrite or index replacement is needed for this migration.
    for (let stmt of additions) db.query(stmt)
    let store = storage(db, vocab, {
      derived: loaded.derived,
      backed: loaded.backed,
      number: readConfig(config!).numbers,
    })
    let g = graph({
      storage: store,
      vocab,
      plugins: [
        archetypes(),
        journal(log({ rows: (s) => db!.query(s), derived: loaded.derived })),
      ],
    })
    say('integrity-before', integrity(db))
    let baseline = counts(db, objects(db))
    let history = await journalSnapshot(db)
    say('before', { counts: baseline, journal: history })
    let selected = () => sync(g.read(FIND))
    let candidates = selected()
    let states = Object.fromEntries(
      ['queued', 'active', 'waiting', 'settled'].map((
        state,
      ) => [
        state,
        candidates.filter((r) =>
          (r.dispatch as Record<string, unknown>)?.state == state
        ).length,
      ]),
    )
    let move = () => {
      let moved = 0
      while (true) {
        let rows = selected().slice(0, 50)
        if (!rows.length) break
        let patches = rows.flatMap(dispatchMove)
        assert(
          patches.length == rows.length,
          'Converter refused a selected legacy row',
        )
        sync(g.apply(patches))
        moved += rows.length
        assert(moved <= candidates.length, 'Migration made no progress')
      }
      return moved
    }
    let rollback = Symbol('rehearsal rollback')
    let rehearsed = 0
    try {
      store.tx(() => {
        rehearsed = move()
        throw rollback
      })
    } catch (e) {
      if (e !== rollback) throw e
    }
    assert(rehearsed == candidates.length, 'Rehearsal count differs')
    assert(same(counts(db, objects(db)), baseline), 'Rehearsal changed counts')
    assert(
      same(await journalSnapshot(db), history),
      'Rehearsal changed journal',
    )
    say('rehearsal', {
      states,
      candidates: candidates.length,
      moved: rehearsed,
      rolledBack: true,
    })
    if (opts.mode == 'rehearsal') {
      say('rehearsal-complete', {
        originalCopyChanged: false,
        integrity: integrity(db),
      })
      return
    }
    let moved = move()
    assert(
      moved == candidates.length && !selected().length,
      'Legacy dispatch rows remain',
    )
    for (let row of sync(g.get(candidates.map((r) => r.entity.eid)))) {
      let old = candidates.find((r) => r.entity.eid == row.entity.eid)!
      let prior = old.dispatch as Record<string, unknown>
      let state = prior.state
      assert(
        Boolean(row.admitted) == (state == 'active'),
        'admitted mark differs',
      )
      assert(
        Boolean(row.waiting) == (state == 'waiting'),
        'waiting mark differs',
      )
      if (state == 'settled') assert(!row.dispatch, 'settled envelope retained')
      else {
        let now = row.dispatch as Record<string, unknown>
        assert(
          now && now.state === undefined && now.args == prior.args &&
            now.order == prior.order,
          'Envelope not preserved',
        )
      }
    }
    let ends = Object.fromEntries(
      Object.entries(history).map(([name, h]) => [name, h.end]),
    )
    assert(
      same(await journalSnapshot(db, ends), history),
      'Pre-existing journal prefix changed',
    )
    let after = objects(db)
    let expectedIndexes = indexes(before).concat(additions.flatMap((stmt) => {
      if (stmt.t != 'create index') return []
      return after.filter((r) => r.name == stmt.name)
    })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
    assert(
      same(
        indexes(after).sort((a, b) =>
          String(a.name).localeCompare(String(b.name))
        ),
        expectedIndexes,
      ),
      'Indexes changed',
    )
    let finalCounts = counts(db, after)
    let mutable = new Set([
      'dispatch',
      'admitted',
      'waiting',
      'entity',
      'archetype',
      'created',
      'updated',
      'tombstone',
      ...JOURNAL,
    ])
    for (let [name, n] of Object.entries(baseline)) {
      if (!mutable.has(name)) {
        assert(finalCounts[name] == n, `Unrelated table count changed: ${name}`)
      }
    }
    assert(
      finalCounts.dispatch == baseline.dispatch - states.settled,
      'Dispatch component count differs',
    )
    if (moved) {
      assert(
        finalCounts.journal_change > baseline.journal_change,
        'Journal was not enabled',
      )
    }
    let second = move()
    assert(
      second == 0 && same(counts(db, after), finalCounts),
      'Second run changed counts',
    )
    assert(same(objects(db), after), 'Second run changed schema/indexes')
    say('proof', {
      moved,
      secondRunMoved: second,
      counts: finalCounts,
      indexes: indexes(after),
      journalPrefixPreserved: true,
      integrity: integrity(db),
      originalCopyChanged: !temp,
    })
  } finally {
    db?.close()
    if (temp) await Deno.remove(temp, { recursive: true })
  }
}
if (import.meta.main) {
  try {
    await run()
  } catch (e) {
    say('blocked', { message: e instanceof Error ? e.message : String(e) })
    Deno.exitCode = 1
  }
}
