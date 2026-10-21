// One-time move onto @yaks/file (D-131267): every file the box's graph named by
// a path string becomes a `file{path, root}` entity, and the words that named
// one go. It opens only the database it is given and composes words, never a
// host, so no service, importer or effect runs while the rows move.
//
//   deno run -A bin/migrate-files.ts CONFIG ABSOLUTE_DB check|apply
//
// - this computer's root volume, `volume{machine, mount: '/'}`;
// - each `log{session, source, consumed, version, finished}` becomes the file
//   at its source, carrying `transcript{session, consumed, version,
//   finished}`, and the log entity is deleted;
// - each `session.log` becomes `session.transcript`, the file its log was;
// - each entry's `imported{source, line}` becomes `lines{file, start: line}` on
//   the file at its source; an entry whose source is no path (the `native` and
//   `managed` sentinels) never came from a file and keeps nothing;
// - each repository file's `file.repository` becomes `file.root`, its eid
//   unchanged;
// - the schema work installing the new words owed is finished, and the
//   emptied tables, columns and indexes are dropped.
//
// `check` counts what would move. `apply` moves it in batches, each its own
// transaction, and a second `apply` finds nothing left.
import { words } from '../packages/cli/words.ts'
import { read } from '../packages/cli/config.ts'
import { open } from '../packages/sqlite/db.ts'
import { storage } from '@yaks/sqlite'
import { owed, work } from '@yaks/sqlite/owe'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { archetypes } from '@yaks/archetype'
import { journal, log } from '@yaks/journal'
import { aliases } from '@yaks/alias'
import { ids as numbered } from '@yaks/id/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { onDisk } from '@yaks/file/local'
import {
  as,
  col,
  eq,
  fn,
  gt,
  join,
  left,
  lit,
  not,
  notNull,
  op,
  select,
  star,
  type Stmt,
  table,
} from '@yaks/sql'

let [config, path, mode = 'check'] = Deno.args
if (!config || !path || !['check', 'apply'].includes(mode)) {
  throw Error('Usage: migrate-files.ts CONFIG ABSOLUTE_DB check|apply')
}

// The words as they are now, and the retired ones beside them while their rows
// move, so the graph clears them and keeps every archetype true.
let loaded = await words(read(config))
let docs = structuredClone(loaded.docs)
let add = (comp: string, props: Record<string, unknown>) => {
  let d = docs.find((d) => d.$defs?.[comp]?.component === true)
  if (!d) throw Error('The composed vocabulary declares no ' + comp)
  Object.assign(d.$defs![comp].properties ??= {}, props)
}
add('file', {
  repository: { type: 'string', ref: 'entity', death: 'keep' },
})
add('session', {
  log: { type: 'string', ref: 'entity', death: 'detach', stamped: true },
})
let retired: VocabDoc = {
  title: 'retired',
  $defs: {
    imported: {
      component: true,
      journal: false,
      type: 'object',
      properties: {
        source: { type: 'string', stamped: true },
        line: { type: 'number', stamped: true },
      },
    },
    log: {
      component: true,
      journal: false,
      type: 'object',
      properties: {
        session: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          stamped: true,
        },
        source: { type: 'string', stamped: true },
        consumed: { type: 'number', stamped: true },
        version: { type: 'string', stamped: true },
        finished: { type: 'string', stamped: true },
      },
    },
  },
}
let vocab = loadVocab([...docs, retired], loaded.vocab.keywords)
let db = open(path)
let store = storage(db, vocab, {
  derived: loaded.derived,
  backed: loaded.backed,
})
for (let e of store.install()) console.error(String(e))
let g = graph({
  storage: store,
  vocab,
  plugins: [
    archetypes(),
    numbered(vocab),
    aliases(),
    journal(log({ rows: (s) => db.query(s), derived: loaded.derived }), vocab),
  ],
})

let say = (name: string, value: unknown) =>
  console.log(JSON.stringify({ name, value }))
let q = (s: Stmt) => db.query(s) as Record<string, unknown>[]
let has = (name: string) =>
  q(select({
    from: table('sqlite_schema'),
    where: eq(col('name'), lit(name)),
  })).length > 0
let count = (name: string, where?: string) =>
  has(name)
    ? Number(
      q(select({
        cols: [fn('count', star())],
        from: table(name),
        ...where ? { where: notNull(col(where)) } : {},
      }))[0]['count(*)'],
    )
    : 0
let counts = () => ({
  imported: count('imported'),
  log: count('log'),
  'session.log': has('session') && columns('session').includes('log')
    ? count('session', 'log')
    : 0,
  'file.repository': columns('file').includes('repository')
    ? count('file', 'repository')
    : 0,
  file: count('file'),
  'file.root': count('file', 'root'),
  lines: count('lines'),
  transcript: count('transcript'),
  'session.transcript': count('session', 'transcript'),
  volume: count('volume'),
})
let columns = (name: string) =>
  has(name)
    ? q({ t: 'pragma', name: 'table_info', arg: name } as Stmt).map((r) =>
      String(r.name)
    )
    : []

// One page of a table's rows past `after`, each with its entity's eid and the
// eid of each reference named.
let page = (
  name: string,
  props: string[],
  refs: string[],
  after: number,
  size: number,
) =>
  q(select({
    cols: [
      col('entity', 'r'),
      as(col('eid', 'e'), 'eid'),
      ...props.map((p) => col(p, 'r')),
      ...refs.map((p) => as(col('eid', `x_${p}`), `${p}_eid`)),
    ],
    from: table(name, 'r'),
    joins: [
      join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 'r'))),
      ...refs.map((p) =>
        left(table('entity', `x_${p}`), eq(col('id', `x_${p}`), col(p, 'r')))
      ),
    ],
    where: gt(col('entity', 'r'), lit(after)),
    order: [col('entity', 'r')],
    limit: lit(size),
  }))

let files = new Map<string, Bundle>()
// The files written so far, by eid.
let written = new Set<string>()
let fileAt = async (source: string) => {
  let held = files.get(source)
  if (held) return held
  let [b] = await onDisk(g, source)
  files.set(source, b)
  return b
}
let isPath = (s: unknown): s is string =>
  typeof s == 'string' && s.startsWith('/')

let before = counts()
say('before', before)
if (mode == 'check') {
  let sentinels = has('imported')
    ? q(select({
      cols: [col('source'), fn('count', star())],
      from: table('imported'),
      where: not(op('like', col('source'), lit('/%'))),
      group: [col('source')],
    }))
    : []
  say('sentinels', sentinels)
  Deno.exit(0)
}

let batch = async (bundles: Bundle[]) => {
  if (bundles.length) {
    await g.apply(bundles, { trusted: true, stamp: false })
  }
}
let moved = { files: 0, transcripts: 0, sessions: 0, lines: 0, cleared: 0 }

// Repository files: `repository` becomes `root`, stated with the path so the
// graph checks the eid still derives from them.
for (let after = 0;;) {
  if (!columns('file').includes('repository')) break
  let all = page('file', ['path', 'repository'], ['repository'], after, 2000)
  if (!all.length) break
  after = Number(all.at(-1)!.entity)
  let rows = all.filter((r) => r.repository != null)
  let lost = rows.filter((r) => r.repository_eid == null)
  if (lost.length) throw Error(`${lost.length} files name a missing repository`)
  await batch(rows.map((r) => ({
    entity: { eid: String(r.eid) },
    file: { path: r.path, root: r.repository_eid, repository: null },
  })))
  moved.files += rows.length
}

// Logs: each becomes the file at its source, carrying how far it was read.
let logFile = new Map<string, string>()
for (let after = 0;;) {
  if (!has('log')) break
  let rows = page(
    'log',
    ['source', 'consumed', 'version', 'finished'],
    ['session'],
    after,
    500,
  )
  if (!rows.length) break
  after = Number(rows.at(-1)!.entity)
  let out: Bundle[] = []
  for (let r of rows) {
    if (isPath(r.source)) {
      let file = await fileAt(r.source)
      logFile.set(String(r.eid), file.entity.eid)
      written.add(file.entity.eid)
      out.push({
        ...file,
        transcript: {
          session: r.session_eid ?? null,
          consumed: r.consumed ?? null,
          version: r.version ?? null,
          finished: r.finished ?? null,
        },
      })
      moved.transcripts++
    }
  }
  await batch(out)
  if (rows.length < 500) break
}

// Sessions: `log` becomes `transcript`, the file its log was.
for (let after = 0;;) {
  if (!columns('session').includes('log')) break
  let all = page('session', ['log'], ['log'], after, 2000)
  if (!all.length) break
  after = Number(all.at(-1)!.entity)
  let rows = all.filter((r) => r.log != null)
  await batch(rows.map((r) => ({
    entity: { eid: String(r.eid) },
    session: {
      log: null,
      ...logFile.has(String(r.log_eid))
        ? { transcript: logFile.get(String(r.log_eid)) }
        : {},
    },
  })))
  moved.sessions += rows.length
}

// The log entities go, now nothing names them.
for (let after = 0;;) {
  if (!has('log')) break
  let rows = page('log', [], [], after, 2000)
  if (!rows.length) break
  after = Number(rows.at(-1)!.entity)
  await batch(
    rows.map((r) => ({ entity: { eid: String(r.eid) }, $delete: true })),
  )
}

// Entries: `imported` becomes the line of the file they were read from.
for (let after = 0;;) {
  if (!has('imported')) break
  let rows = page('imported', ['source', 'line'], [], after, 2000)
  if (!rows.length) break
  after = Number(rows.at(-1)!.entity)
  let out: Bundle[] = []
  for (let r of rows) {
    let at = isPath(r.source)
      ? { lines: { file: (await fileAt(r.source)).entity.eid, start: r.line } }
      : {}
    out.push({ entity: { eid: String(r.eid) }, imported: null, ...at })
    if (at.lines) moved.lines++
    else moved.cleared++
  }
  // A file only entries name is written with them.
  let named = new Set(
    out.flatMap((b) => b.lines ? [String((b.lines as Comp).file)] : []),
  )
  let fresh = [...files.values()].filter((f) =>
    named.has(f.entity.eid) && !written.has(f.entity.eid)
  )
  for (let f of fresh) written.add(f.entity.eid)
  await batch([...fresh, ...out])
}
say('moved', moved)

let remaining = counts()
say('after', remaining)
if (
  remaining.imported || remaining.log || remaining['session.log'] ||
  remaining['file.repository']
) {
  throw Error('Rows are left in the old shape; nothing is dropped')
}

// The schema work installing the new words left owed (the session table's
// rebuild for its new reference) is finished first, so no rebuild done later
// carries a retired column back.
for (let i = 0; owed(db).length; i++) {
  if (i > 100_000) throw Error('Owed schema work does not finish')
  let did = work(db, Date.now())
  if (did && 'error' in did) throw did.error
}

// What held the old shape goes: the indexes on the old columns, the columns,
// and the two tables.
let drops: Stmt[] = [
  ...['file_repository', 'file_path_repository', 'session_log', 'log_session']
    .filter(has).map((name) => ({ t: 'drop', kind: 'index', name }) as Stmt),
  ...columns('file').includes('repository')
    ? [{ t: 'alter table', table: 'file', drop: 'repository' } as Stmt]
    : [],
  ...columns('session').includes('log')
    ? [{ t: 'alter table', table: 'session', drop: 'log' } as Stmt]
    : [],
  ...['imported', 'log'].filter(has).map((name) =>
    ({ t: 'drop', kind: 'table', name }) as Stmt
  ),
]
for (let s of drops) q(s)
say('dropped', drops.length)
db.close()
