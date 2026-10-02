// T-59064's one-time local repair. Only an explicitly named existing database
// is opened; the live file additionally needs --live. Vocabulary comes from the
// local config, but no host, services, effects or startup movers are composed.
// --plan requires a disposable copy: additive schema is rehearsed and rolled
// back so classification can read the new columns without modifying graph data.
// --admit checks that the measured schema still matches; it is not a grant.
// --verify-zero is a separate invocation with an empty schema delta.
import { configPath, read } from '../packages/cli/config.ts'
import { words } from '../packages/cli/host.ts'
import { open } from '../packages/sqlite/db.ts'
import { storage } from '@yaks/sqlite'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { token } from '../packages/graph/guard.ts'
import { parse } from '@yaks/query'
import {
  among,
  as,
  col,
  type Column,
  count,
  each,
  eq,
  fn,
  gt,
  join,
  op,
  type Row,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import {
  ddl as journalDdl,
  journal as journalPlugin,
  log,
} from '../packages/journal/mod.ts'
import { componentTables, objects } from '../packages/sqlite/physical.ts'
import { indexed, tabled } from '../packages/sqlite/ddl.ts'
import { unit } from '../packages/sqlite/unit.ts'
import { canonical as tableNames, eidOf } from '../packages/archetype/sets.ts'
import { sessionDoc } from '../packages/session/comp.ts'
import { rules as archetypeRules } from '../packages/archetype/rules.ts'
import { rules as blobRules } from '../packages/blob/rules.ts'
import { blobSchema, sqliteBlobs } from '../packages/blob/sqlite.ts'
import {
  refusalFind,
  refusalPatch,
  refusalPrior,
  refusalSource,
} from '../packages/tools/refusals.ts'

// Only our diagnostics and the helper's bounded identity/code diagnostic may
// reach stderr. Driver/precondition errors can carry historical payloads.
class Stop extends Error {}
class Planned extends Error {}
let fail: (message: string) => never = (message) => {
  throw new Stop(message)
}
let report = (stage: string, value: unknown) =>
  console.log(JSON.stringify({ stage, value }))
let component = (row: Bundle, name: string): Comp => {
  let value = row[name]
  return value && typeof value == 'object' ? value : {}
}
let canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value == 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map((
        [key, v],
      ) => [key, canonical(v)]),
    )
  }
  return value ?? null
}
let same = (a: unknown, b: unknown) =>
  token(canonical(a)) == token(canonical(b))
let args = () => {
  let db: string | undefined
  let config: string | undefined
  let live = false
  let plan = false
  let verifyZero = false
  let admit: string | undefined
  let batch = 200
  for (let i = 0; i < Deno.args.length; i++) {
    let arg = Deno.args[i]
    if (arg == '--live') live = true
    else if (arg == '--plan') plan = true
    else if (arg == '--verify-zero') verifyZero = true
    else if (
      arg == '--db' || arg == '--config' || arg == '--batch' || arg == '--admit'
    ) {
      let value = Deno.args[++i]
      if (!value || value.startsWith('--')) fail(`Missing value for ${arg}`)
      if (arg == '--db') db = value
      else if (arg == '--config') config = value
      else if (arg == '--admit') admit = value
      else batch = Number(value)
    } else fail(`Unknown argument: ${arg}`)
  }
  if (!db) {
    fail(
      'Required: --db EXISTING_FILE (--plan | --admit DIGEST) [--config FILE] [--live]',
    )
  }
  if (!Number.isInteger(batch) || batch < 1 || batch > 1000) {
    fail('--batch must be an integer from 1 to 1000')
  }
  if (!plan && !admit) fail('Required: --plan or --admit PLAN_DIGEST')
  if (plan && admit) fail('--plan and --admit are mutually exclusive')
  if (verifyZero && (plan || !admit)) {
    fail('--verify-zero requires --admit EMPTY_SCHEMA_DIGEST, without --plan')
  }
  return {
    db: db ?? fail('Missing --db'),
    config,
    live,
    batch,
    plan,
    admit,
    verifyZero,
  }
}

let main = async () => {
  let started = performance.now()
  let options = args()
  let path = configPath(options.config) ?? fail('No local vocabulary config')
  let config = read(path)
  let db = await Deno.realPath(options.db)
  let info = await Deno.stat(db)
  if (!info.isFile) fail('--db must name an existing regular file')
  let livePaths = [config.db, `${Deno.env.get('HOME')}/.yak/yak.db`]
  for (let path of livePaths) {
    if (!path) continue
    try {
      let real = await Deno.realPath(path)
      let liveInfo = await Deno.stat(real)
      if (
        (db == real || (info.ino != null && info.ino == liveInfo.ino &&
          info.dev == liveInfo.dev)) && (options.plan || !options.live)
      ) {
        fail('--plan requires a copy; live repair requires --live and a backup')
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
  }
  // Load every configured word before opening SQLite, so import/config errors
  // cannot accidentally create or modify a database. --db never uses config.db.
  let spoken = await words(config)
  for (
    let name of [
      'error',
      'refusal',
      'archetype',
      'content',
      'imported',
      'result',
      'output',
    ]
  ) {
    if (!spoken.vocab.comp(name)) fail(`Configured vocabulary lacks ${name}`)
  }
  if (
    !spoken.docs.some((doc) =>
      Object.entries(sessionDoc).every(([key, value]) =>
        same(doc[key as keyof typeof doc], value)
      )
    )
  ) {
    fail('Configured vocabulary lacks complete sessionDoc')
  }
  report('opening', {
    db,
    config: path,
    live: options.live,
    batch: options.batch,
    verifyZero: options.verifyZero,
  })
  let sql = open(db)
  try {
    let run = async () => {
      let tally = (name: string) =>
        Object.fromEntries(
          sql.query(select({
            cols: [col('code'), as(count(), 'n')],
            from: table(name),
            group: [col('code')],
          })).map((r) => [String(r.code), Number(r.n)]),
        )
      let store = storage(sql, spoken.vocab, {
        derived: spoken.derived,
        backed: spoken.backed,
        number: config.numbers ?? false,
        adopt: config.adopt ?? false,
      })
      // Read the complete schema, but never reconcile it. Unrelated missing or
      // incompatible objects fail closed. Only the explicitly scoped admission
      // below can create objects/add columns, never drop/refit/backfill/schema-mark.
      let schemaBefore = objects(sql)
      let byName = new Map(schemaBefore.map((row) => [String(row.name), row]))
      let journalTables = ['journal_tx', 'journal_change', 'journal_field']
      let high = (name: string) =>
        byName.has(name)
          ? Number(
            sql.query(select({
              cols: [as(fn('max', col('id')), 'n')],
              from: table(name),
            }))[0]?.n ?? 0,
          )
          : 0
      let size = (name: string) =>
        Number(
          sql.query(select({
            cols: [as(count(), 'n')],
            from: table(name),
          }))[0]?.n ?? 0,
        )
      // Bounded full physical history once before admission and once after repair.
      // Journal writes are append-only (log.ts); known triggers are validated above
      // and each batch independently checks its appended records before commit.
      let journalDigest = (name: string, last: number) => {
        let digest = token(null)
        let cursor = 0
        if (!last) return digest
        for (;;) {
          let rows = sql.query(
            select({
              from: table(name),
              where: op(
                'and',
                gt(col('id'), val(cursor)),
                op('<=', col('id'), val(last)),
              ),
              order: [col('id')],
              limit: val(1000),
            }),
          )
          if (!rows.length) return digest
          digest = token([
            digest,
            rows.map((row) =>
              canonical(
                name == 'journal_tx' ? { host: null, ...row } : row,
              )
            ),
          ])
          cursor = Number(rows.at(-1)!.id)
        }
      }
      let journalLimits = Object.fromEntries(
        journalTables.map((name) => [name, high(name)]),
      )
      let admission: Stmt[] = []
      let tableInfo = (name: string) =>
        sql.query({
          t: 'pragma',
          name: 'table_xinfo',
          arg: name,
        })
      // Both imported properties are projected by a full bundle read. Missing
      // imported itself is unrelated: only an existing table may gain these.
      let allowedColumn = (name: string, column: Column) =>
        !column.pk && !column.notNull && !column.unique && !column.default &&
        !column.check && !column.ref && !column.autoincrement &&
        ((name == 'refusal' && column.name == 'code' &&
          column.type == 'text') ||
          (name == 'imported' && column.name == 'source' &&
            column.type == 'text') ||
          (name == 'imported' && column.name == 'line' &&
            column.type == 'real') ||
          (name == 'journal_tx' && column.name == 'host' &&
            column.type == 'text'))
      let journalRequirements = journalDdl()
      let journalNames = new Set(
        journalRequirements.flatMap((stmt) =>
          'name' in stmt ? [stmt.name] : []
        ),
      )
      let allowedObject = (stmt: Stmt) =>
        (stmt.t == 'create table' &&
          (stmt.name == 'refusal' || journalNames.has(stmt.name))) ||
        (stmt.t == 'create index' &&
          (stmt.on == 'refusal' || journalNames.has(stmt.name)))
      // Inert canonical definitions, not storage.ddl()'s live grown() plan. Full
      // vocabulary reads can probe all component tables on unclassified entities;
      // every unrelated requirement must therefore already be compatible.
      let requirements = [
        ...tabled(spoken.vocab, spoken.derived),
        ...indexed(spoken.vocab),
        ...journalRequirements,
        ...blobSchema(),
      ]
      let plannedNames = new Set<string>()
      for (let stmt of requirements) {
        if (
          stmt.t != 'create table' && stmt.t != 'create index' &&
          stmt.t != 'create view' && stmt.t != 'create trigger'
        ) continue
        if (plannedNames.has(stmt.name)) {
          fail(`Duplicate schema requirement: ${stmt.name}`)
        }
        plannedNames.add(stmt.name)
        let existing = byName.get(stmt.name)
        let kind = stmt.t.slice('create '.length)
        if (!existing) {
          if (!allowedObject(stmt)) {
            fail(`Missing unrelated physical object: ${stmt.name}`)
          }
          admission.push(stmt)
          continue
        }
        if (existing.type != kind) {
          fail(`Physical object type collision: ${stmt.name}`)
        }
        if (stmt.t != 'create table') continue
        let cols = tableInfo(stmt.name)
        for (let column of stmt.cols) {
          let held = cols.find((row) => row.name == column.name)
          if (!held) {
            if (!allowedColumn(stmt.name, column)) {
              fail(
                `Missing unrelated physical column: ${stmt.name}.${column.name}`,
              )
            }
            admission.push({ t: 'alter table', table: stmt.name, add: column })
          } else if (
            Number(held.hidden) || Number(held.pk) != Number(!!column.pk)
          ) {
            fail(`Incompatible physical column: ${stmt.name}.${column.name}`)
          }
        }
      }
      // Additional ordinary indexes/views remain untouched. Unknown triggers or
      // unique indexes on tables this repair writes are not safe to infer away.
      let written = new Set([
        'entity',
        'error',
        'refusal',
        'updated',
        'archetype',
        'journal_tx',
        'journal_change',
        'journal_field',
        'blob_text',
      ])
      let scratch = open(':memory:')
      try {
        for (let stmt of requirements) {
          if (stmt.t != 'create table' && stmt.t != 'create trigger') continue
          scratch.query(stmt)
        }
        let known = new Map(
          objects(scratch).map((row) => [String(row.name), row]),
        )
        let tokens = (sql: unknown) =>
          String(sql).match(
            /'(?:[^']|'')*'|"(?:[^"]|"")*"|[\w$]+|[^\s\w]/g,
          )?.map((part) =>
            part.startsWith("'")
              ? part
              : part.replace(/^"|"$/g, '').toLowerCase()
          )
        for (let row of schemaBefore) {
          if (row.type != 'trigger' || !written.has(String(row.tbl_name))) {
            continue
          }
          let expected = known.get(String(row.name))
          if (!expected || !same(tokens(row.sql), tokens(expected.sql))) {
            fail(`Unproved write-affecting trigger: ${row.name}`)
          }
        }
      } finally {
        scratch.close()
      }
      for (let name of written) {
        if (!byName.has(name)) continue
        for (
          let row of sql.query({ t: 'pragma', name: 'index_list', arg: name })
        ) {
          if (
            Number(row.unique) && row.origin == 'c' &&
            !plannedNames.has(String(row.name))
          ) {
            fail(`Unproved write-affecting unique index: ${row.name}`)
          }
        }
      }
      // Removing an error row must not cascade into another physical table.
      for (let row of schemaBefore) {
        if (row.type != 'table' || String(row.name).startsWith('sqlite_')) {
          continue
        }
        if (
          sql.query({
            t: 'pragma',
            name: 'foreign_key_list',
            arg: String(row.name),
          })
            .some((key) => key.table == 'error')
        ) {
          fail(`Unproved inbound error foreign key: ${row.name}`)
        }
      }
      let schemaSummary = (rows: Row[]) =>
        rows.map((row) => ({
          type: row.type,
          name: row.name,
          table: row.tbl_name,
          definition: token(row.sql),
        }))
      let schemaDigest = token(canonical({ schema: schemaBefore, admission }))
      report('schema-plan', {
        digest: schemaDigest,
        beforeObjects: schemaBefore.length,
        additive: admission,
        otherChanges: 0,
      })
      if (!options.plan && options.admit != schemaDigest) {
        fail('Schema digest differs; run --plan on a fresh copy')
      }
      if (options.verifyZero && admission.length) {
        fail('--verify-zero forbids every schema admission')
      }
      let historicalJournal = Object.fromEntries(
        Object.entries(journalLimits)
          .map((
            [name, last],
          ) => [name, options.plan ? '' : journalDigest(name, last)]),
      )
      let preserveHistory = () => {
        if (options.plan) return
        for (let [name, last] of Object.entries(journalLimits)) {
          if (journalDigest(name, last) != historicalJournal[name]) {
            fail('Historical journal changed')
          }
        }
      }
      let schemaInstalled: Row[] = []
      unit(sql, () => {
        if (!same(schemaBefore, objects(sql))) {
          fail('Physical schema changed after planning')
        }
        for (let stmt of admission) sql.query(stmt)
        schemaInstalled = objects(sql)
        let changedTables = new Set(
          admission.flatMap((stmt) =>
            stmt.t == 'alter table' ? [stmt.table] : []
          ),
        )
        let createdObjects = new Set(
          admission.flatMap((stmt) => 'name' in stmt ? [stmt.name] : []),
        )
        let installedByName = new Map(
          schemaInstalled.map((row) => [String(row.name), row]),
        )
        for (let row of schemaBefore) {
          let current = installedByName.get(String(row.name))
          if (
            !current ||
            (!changedTables.has(String(row.name)) && !same(row, current))
          ) {
            fail(`Unexpected schema admission effect: ${row.name}`)
          }
        }
        for (let row of schemaInstalled) {
          if (
            !byName.has(String(row.name)) &&
            !createdObjects.has(String(row.name)) &&
            !(row.sql == null && createdObjects.has(String(row.tbl_name)))
          ) {
            fail(`Unexpected created schema object: ${row.name}`)
          }
        }
      })
      report('postinstall', {
        afterObjects: schemaInstalled.length,
        added: schemaSummary(
          schemaInstalled.filter((row) => !byName.has(String(row.name))),
        ),
        changed: schemaSummary(
          schemaInstalled.filter((row) =>
            byName.has(String(row.name)) &&
            !same(row, byName.get(String(row.name)))
          ),
        ),
        removed: 0,
      })
      // No journalRules(): its constructor executes DDL. Supply both clocks and
      // the host ourselves so journal metadata has an independent exact oracle.
      let writeAt = ''
      let journalHost = crypto.randomUUID()
      let n = log({
        rows: (stmt) => sql.query(stmt),
        derived: spoken.derived,
        host: journalHost,
      })
      let g = graph({
        clock: () => writeAt,
        storage: store,
        vocab: spoken.vocab,
        plugins: [
          ...blobRules({ vocab: spoken.vocab, blobs: sqliteBlobs(sql) }),
          ...archetypeRules(),
          journalPlugin(n, { now: () => writeAt }),
        ],
        // Suppress declared vocabulary rules, not core stamps or effects.
        // These explicit plugins have no effect observers; do not compose any.
        runs: () => false,
      })
      let source = async (row: Bundle) => {
        let query = refusalSource(row)
        if (!query) return undefined
        let rows = await g.read(parse(query))
        if (rows.length != 1) {
          fail(`Missing refusal source: eid=${row.entity.eid}`)
        }
        return rows[0]
      }
      let classify = async (row: Bundle) => {
        let query = refusalPrior(row)
        let prior: Bundle | null | undefined
        if (query) {
          let rows = await g.read(parse(query))
          if (rows.length > 1) {
            fail(`Ambiguous prior entry: eid=${row.entity.eid}`)
          }
          prior = rows[0] ?? null
        }
        return refusalPatch(row, await source(row), prior)
      }
      let pages = async function* (query: string) {
        let after: string | undefined
        for (;;) {
          let rows = await g.read(
            parse(
              `${query}&.limit=${options.batch}${
                after ? `&.after=${after}` : ''
              }`,
            ),
          )
          if (!rows.length) return
          yield rows
          after = rows.at(-1)!.entity.eid
        }
      }
      let guard = (row: Bundle, patch: Bundle): Bundle => {
        let was = { ...patch.$was }
        // Preserve helper/caller guards, adding checks only where none exist.
        for (
          let [name, prop] of [
            ['error', 'code'],
            ['refusal', 'code'],
            ['result', 'call'],
            ['output', 'source'],
            ['imported', 'source'],
          ]
        ) {
          was[name] = { ...was[name] }
          if (!(prop in was[name])) {
            was[name][prop] = token(component(row, name)[prop])
          }
        }
        return { ...patch, $was: was }
      }
      let scan = async () => {
        let patches: Bundle[] = []
        let seen = new Set<string>()
        let retained: Record<string, number> = {}
        let removed: Record<string, number> = {}
        let added: Record<string, number> = {}
        let moved: Record<string, number> = {}
        let increment = (counts: Record<string, number>, code: unknown) => {
          let key = String(code)
          counts[key] = (counts[key] ?? 0) + 1
        }
        for (let query of refusalFind) {
          for await (let rows of pages(query)) {
            for (let row of rows) {
              if (seen.has(row.entity.eid)) continue
              seen.add(row.entity.eid)
              let patch = await classify(row)
              if (patch) {
                patches.push(guard(row, patch))
                increment(
                  moved,
                  component(patch.refusal ? patch : row, 'refusal').code,
                )
                if (patch.error === null) {
                  increment(removed, component(row, 'error').code)
                }
                if (patch.refusal) {
                  increment(added, component(patch, 'refusal').code)
                }
              } else {
                let code = String(component(row, 'error').code ?? 'result-only')
                retained[code] = (retained[code] ?? 0) + 1
              }
            }
          }
          report('scan', { candidates: seen.size, patches: patches.length })
        }
        return {
          patches,
          retained,
          removed,
          added,
          moved,
          candidates: seen.size,
        }
      }
      // Classify the whole historical selection first. An unknown row stops us
      // before any graph patch is committed (schema admission may already occur).
      let before = { error: tally('error'), refusal: tally('refusal') }
      let planned = await scan()
      if (options.verifyZero && planned.patches.length) {
        fail(
          '--verify-zero requires an empty data plan; no repair was attempted',
        )
      }
      report('plan', {
        before,
        candidates: planned.candidates,
        patches: planned.patches.length,
        byCode: planned.moved,
        removed: planned.removed,
        added: planned.added,
        retained: planned.retained,
      })
      let journal = () => ({
        transactions: size('journal_tx'),
        changes: size('journal_change'),
        fields: size('journal_field'),
      })
      let journalBefore = journal()
      let indexedTally = async (name: string) =>
        Object.fromEntries(
          (await g.rows(parse(`.${name}&.tally=${name}.code`)))
            .map((r) => [String(r.value), Number(r.n)]),
        )
      let checkTallies = async () => {
        for (let name of ['error', 'refusal']) {
          if (!same(await indexedTally(name), tally(name))) {
            fail(`Graph/SQL tally mismatch: ${name}`)
          }
        }
      }
      await checkTallies()
      // Only the automatic updated stamp and the changed archetype pointer may
      // move besides error/refusal. Every lifecycle mark/state stays in the digest.
      let preserved = (row: Bundle) => {
        let { error: _, refusal: __, updated: ___, entity, ...rest } = row
        let { archetype: ____, ...identity } = entity
        return { entity: identity, ...rest }
      }
      // Independent physical census: descriptors and vocabulary projection are
      // not evidence that an unknown component/extra column survived. Read every
      // ordinary component table's complete rows without resolving blob payloads.
      let physicalNames = componentTables(sql)
      for (let name of physicalNames) {
        let keys = tableInfo(name).filter((row) => Number(row.pk) > 0)
          .sort((a, b) => Number(a.pk) - Number(b.pk))
        if (
          keys.length != 1 || keys[0].name != 'entity' ||
          Number(keys[0].pk) != 1
        ) {
          fail(`Unproved physical component primary key: ${name}`)
        }
      }
      type Physical = { identity: Row; components: Map<string, Row> }
      let physical = (eids: string[]) => {
        let identities = sql.query(select({
          from: table('entity'),
          where: among(col('eid'), each(eids)),
        }))
        let result = new Map<string, Physical>()
        let owners = new Map<number, Physical>()
        for (let identity of identities) {
          if (!Number.isInteger(identity.id)) {
            fail('Invalid physical entity identity')
          }
          let held = { identity, components: new Map<string, Row>() }
          result.set(String(identity.eid), held)
          owners.set(Number(identity.id), held)
        }
        let ids = [...owners.keys()]
        for (let name of physicalNames) {
          for (
            let row of sql.query(select({
              from: table(name),
              where: among(col('entity'), each(ids)),
            }))
          ) {
            let held = owners.get(Number(row.entity)) ??
              fail('Unexpected physical owner')
            if (held.components.has(name)) {
              fail(`Duplicate physical component: ${name}`)
            }
            held.components.set(name, row)
          }
        }
        return result
      }
      let membership = (held: Physical) => tableNames(held.components.keys())
      let descriptor = (held: Physical) => {
        let id = held.identity.archetype
        if (!Number.isInteger(id)) {
          fail(`Unclassified physical candidate: eid=${held.identity.eid}`)
        }
        let rows = sql.query(select({
          cols: [col('tables'), col('eid', 'e')],
          from: table('archetype', 'a'),
          joins: [
            join(table('entity', 'e'), eq(col('entity', 'a'), col('id', 'e'))),
          ],
          where: eq(col('entity', 'a'), val(Number(id))),
        }))
        if (rows.length != 1 || typeof rows[0].tables != 'string') {
          fail('Missing physical descriptor')
        }
        let names: unknown
        try {
          names = JSON.parse(rows[0].tables)
        } catch {
          fail('Invalid physical descriptor')
        }
        if (
          !same(names, membership(held)) ||
          rows[0].eid != eidOf(membership(held))
        ) {
          fail(
            `Physical descriptor membership mismatch: eid=${held.identity.eid}`,
          )
        }
      }
      // An error removal destroys the whole physical row, not only projected
      // vocabulary fields. Only code is authorized for deletion; populated extra
      // fields must stop the whole selection before the first graph apply.
      let expectedMembership = (patch: Bundle, held: Physical) => {
        let names = new Set(held.components.keys())
        for (let name of ['error', 'refusal']) {
          if (patch[name] === null) names.delete(name)
          else if (patch[name] != null) names.add(name)
        }
        // Legacy missing created would generate a new lifecycle mark. That is
        // outside this repair's preservation scope, so refuse rather than stamp.
        if (!names.has('created') && spoken.vocab.comp('created')) {
          fail(`Candidate lacks created provenance: eid=${patch.entity.eid}`)
        }
        if (
          names.has('created') && spoken.vocab.comp('created') &&
          spoken.vocab.comp('updated')
        ) names.add('updated')
        // Core mark rules run even with declarative rules disabled. Do not allow
        // this repair to fill in unrelated historical lifecycle marks.
        for (
          let info of spoken.vocab.all.map((name) => spoken.vocab.comp(name)!)
        ) {
          if (info.name == 'created' || info.name == 'updated' || !info.mark) {
            continue
          }
          let row = held.components.get(info.name)
          if (row && row.at == null) {
            fail(
              `Candidate has unstamped lifecycle mark: eid=${patch.entity.eid}`,
            )
          }
        }
        return tableNames(names)
      }
      let removal = (patch: Bundle, held: Physical) => {
        if (held.identity.eid !== patch.entity.eid) {
          fail('Physical owner eid mismatch')
        }
        if (patch.error !== null) return
        let error = held.components.get('error') ??
          fail('Physical error missing')
        if (
          error.entity !== held.identity.id || typeof error.code != 'string' ||
          !error.code || token(error.code) !== patch.$was?.error?.code ||
          Object.entries(error).some(([key, value]) =>
            key != 'entity' && key != 'code' && value != null
          )
        ) {
          fail(`Unsafe physical error removal: eid=${patch.entity.eid}`)
        }
      }
      for (
        let offset = 0;
        offset < planned.patches.length;
        offset += options.batch
      ) {
        let patches = planned.patches.slice(offset, offset + options.batch)
        let held = physical(patches.map((patch) => patch.entity.eid))
        for (let patch of patches) {
          let row = held.get(patch.entity.eid) ??
            fail('Missing physical candidate')
          descriptor(row)
          removal(patch, row)
          expectedMembership(patch, row)
        }
      }
      if (options.plan) {
        report('plan-complete', {
          patches: planned.patches.length,
          graphChanges: 0,
          schemaCommitted: 0,
          elapsedMs: Math.round(performance.now() - started),
        })
        throw new Planned()
      }
      let physicalChecked = 0
      let physicalCells = 0
      let checked = 0
      let batches = 0
      for (
        let offset = 0;
        offset < planned.patches.length;
        offset += options.batch
      ) {
        let patches = planned.patches.slice(offset, offset + options.batch)
        let ids = patches.map((p) => p.entity.eid)
        // The graph's nested storage unit uses the same driver. Await all
        // preservation/journal assertions before this outer unit commits;
        // any rejection rolls this entire batch back and stops the process.
        await unit(sql, async () => {
          let physicalBefore = physical(ids)
          let originals = await g.get(ids)
          let old = new Map(originals.map((r) => [r.entity.eid, r]))
          if (old.size != patches.length) {
            fail('Candidate disappeared before apply')
          }
          for (let patch of patches) {
            let row = old.get(patch.entity.eid)!
            let fresh = await classify(row)
            if (
              !fresh || !same(fresh.error, patch.error) ||
              !same(fresh.refusal, patch.refusal)
            ) {
              fail(`Candidate changed: eid=${row.entity.eid}`)
            }
          }
          let cursor = high('journal_tx')
          let changeCursor = high('journal_change')
          let fieldCursor = high('journal_field')
          let transactions = size('journal_tx')
          writeAt = new Date().toISOString()
          await g.apply(patches)
          batches++
          if (
            high('journal_tx') != cursor + 1 ||
            size('journal_tx') != transactions + 1
          ) {
            fail('Missing or concurrent journal transaction')
          }
          let changes = sql.query(
            select({
              from: table('journal_change'),
              where: gt(col('id'), val(changeCursor)),
            }),
          )
          let fields = sql.query(
            select({
              from: table('journal_field'),
              where: gt(col('id'), val(fieldCursor)),
            }),
          )
          if (
            !changes.length || fields.some((field) =>
              !changes.some((change) =>
                field.change == change.id
              )
            ) || changes.some((change) => change.tx != cursor + 1)
          ) {
            fail('Unexpected appended journal ownership')
          }
          let physicalAfter = physical(ids)
          for (let patch of patches) {
            let pre = physicalBefore.get(patch.entity.eid) ??
              fail('Missing physical preimage')
            let post = physicalAfter.get(patch.entity.eid) ??
              fail('Missing physical postimage')
            let preIdentity = { ...pre.identity }
            let postIdentity = { ...post.identity }
            delete preIdentity.archetype
            delete postIdentity.archetype
            if (!same(preIdentity, postIdentity)) {
              fail('Physical identity changed')
            }
            let expectedNames = expectedMembership(patch, pre)
            if (!same(expectedNames, membership(post))) {
              fail(`Physical membership changed: eid=${patch.entity.eid}`)
            }
            descriptor(post)
            for (let [name, original] of pre.components) {
              if (name == 'error') continue
              if (name == 'updated') {
                let stamp = new Set(['at', 'by', 'via'])
                let extra = (row: Row) =>
                  Object.fromEntries(
                    Object.entries(row)
                      .filter(([key]) => !stamp.has(key)),
                  )
                let after = post.components.get(name) ??
                  fail('Physical updated row removed')
                if (!same(extra(original), extra(after))) {
                  fail('Physical updated extras changed')
                }
                physicalCells += Object.keys(extra(original)).length
                continue
              }
              if (!same(original, post.components.get(name))) {
                fail(
                  `Physical non-refusal row changed: eid=${patch.entity.eid} component=${name}`,
                )
              }
              physicalCells += Object.keys(original).length
            }
            if (
              !pre.components.has('updated') && post.components.has('updated')
            ) {
              let stamp = post.components.get('updated')!
              if (
                Number(stamp.entity) != Number(pre.identity.id) ||
                Object.entries(stamp).some(([key, value]) =>
                  !['entity', 'at', 'by', 'via'].includes(key) && value != null
                )
              ) {
                fail('Unexpected new physical updated extras')
              }
            }
            let refusal = post.components.get('refusal') ??
              fail('Physical refusal missing')
            if (pre.components.has('refusal')) {
              if (!same(pre.components.get('refusal'), refusal)) {
                fail('Physical existing refusal changed')
              }
            } else if (
              !same(refusal.code, component(patch, 'refusal').code) ||
              Number(refusal.entity) != Number(pre.identity.id) ||
              Object.entries(refusal).some(([key, value]) =>
                key != 'entity' && key != 'code' && value != null
              )
            ) {
              fail('Unexpected physical refusal row')
            }
            physicalChecked++
            let row = (await g.get([patch.entity.eid]))[0]
            let original = old.get(patch.entity.eid)!
            if (!row || !same(preserved(original), preserved(row))) {
              fail(`Non-refusal data changed: eid=${patch.entity.eid}`)
            }
            if (original.refusal && !same(original.refusal, row.refusal)) {
              fail(`Existing refusal changed: eid=${patch.entity.eid}`)
            }
            // SQL reads include nullable schema columns. The helper creates a
            // code-only component, so compare its code rather than row shape.
            if (
              row.error || !row.refusal ||
              !same(
                component(row, 'refusal').code,
                component(patch.refusal ? patch : original, 'refusal').code,
              )
            ) {
              fail(`Refusal patch missing: eid=${patch.entity.eid}`)
            }
            // These use the installed component predicates/indexes, not snapshots.
            let found = await g.read(
              parse(`.entity.eid=${row.entity.eid}&.refusal&!error`),
            )
            if (found.length != 1) {
              fail(`Indexed lookup failed: eid=${row.entity.eid}`)
            }
            checked++
          }
        })
        if (!options.live) {
          sql.query({ t: 'pragma', name: 'wal_checkpoint', arg: 'truncate' })
        }
        report('batch', {
          batches,
          checked,
          total: planned.patches.length,
          elapsedMs: Math.round(performance.now() - started),
        })
      }
      for (let name of ['error', 'refusal']) {
        let result = sql.query({
          t: 'pragma',
          name: 'integrity_check',
          arg: name,
        })
        if (result.length != 1 || Object.values(result[0])[0] != 'ok') {
          fail(`Table/index integrity check failed: ${name}`)
        }
      }
      await checkTallies()
      let again = await scan()
      let after = { error: tally('error'), refusal: tally('refusal') }
      let expected = (
        counts: Record<string, number>,
        delta: Record<string, number>,
        sign: number,
      ) => {
        let result = { ...counts }
        for (let [code, n] of Object.entries(delta)) {
          result[code] = (result[code] ?? 0) + sign * n
        }
        return Object.fromEntries(
          Object.entries(result).filter(([, n]) => n != 0),
        )
      }
      if (
        !same(after.error, expected(before.error, planned.removed, -1)) ||
        !same(after.refusal, expected(before.refusal, planned.added, 1))
      ) {
        fail('Unexpected before/after code counts')
      }
      let journalAfter = journal()
      let delta = {
        transactions: journalAfter.transactions - journalBefore.transactions,
        changes: journalAfter.changes - journalBefore.changes,
        fields: journalAfter.fields - journalBefore.fields,
      }
      if (!same(schemaInstalled, objects(sql))) {
        fail('Schema changed during graph repair')
      }
      report('after', {
        after,
        residuals: again.retained,
        residualCandidates: again.candidates,
        // This is only an in-process residual scan. The copy proof must invoke
        // this script again and show zero patches and zero journal increments.
        residualPatches: again.patches.length,
        checked,
        physicalChecked,
        physicalCells,
        batches,
        journal: delta,
        elapsedMs: Math.round(performance.now() - started),
      })
      if (again.patches.length) fail('Migratable residuals remain')
      preserveHistory()
      if (
        delta.transactions != batches
      ) {
        fail('Missing or unexpected journal records')
      }
    }
    if (options.plan) {
      try {
        await unit(sql, run)
      } catch (error) {
        if (!(error instanceof Planned)) throw error
      }
    } else await run()
  } finally {
    sql.close()
  }
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    let message = error instanceof Error ? error.message : ''
    let safe = error instanceof Stop ||
      /^Unsafe historical refusal: eid=[\w:-]+ code=[\w.:-]+$/.test(message)
    console.error(
      safe
        ? message
        : 'Refusal migration stopped; inspect safe progress, not payloads',
    )
    Deno.exitCode = 1
  }
}
