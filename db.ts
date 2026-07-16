// The fleet entity graph, in one SQLite file. Star ECS: `entities` holds the
// shared primary key (`eid`); component tables (`task`, …) hang off it by that
// same id; `dependencies` are typed eid↔eid edges — anything can block, contain,
// or inform anything. This module owns the file + the seed; routes only read.
import { DatabaseSync } from 'node:sqlite'

let file = './data/tasks.db'

// The edge vocabulary. blocks = hard gate, subtask = decomposition (parent
// rolls up), informs = read-first, never gates.
export type Edge = 'blocks' | 'subtask' | 'informs'

export type Task = {
  eid: number
  title: string
  status: string
  body: string
  created_at: string
}

export type Dep = { src: number; dst: number; type: Edge }

// The star: an entities spine plus one component table per kind, plus the edge
// table. `if not exists` makes this idempotent — safe to run every boot.
let schema = `
  create table if not exists entities (
    eid        integer primary key autoincrement,
    kind       text not null,
    created_at text not null
  );
  create table if not exists task (
    eid    integer primary key references entities(eid),
    title  text not null,
    status text not null,
    body   text not null default ''
  );
  create table if not exists dependencies (
    src_eid integer not null references entities(eid),
    dst_eid integer not null references entities(eid),
    type    text not null check (type in ('blocks','subtask','informs')),
    primary key (src_eid, dst_eid, type)
  );
`

// Copy-tweak-return: mint an entity, hang a task component on it, hand back the
// eid so the caller can wire edges to it.
let addTask = (db: DatabaseSync, title: string, status: string, body = '') => {
  let { lastInsertRowid } = db
    .prepare('insert into entities (kind, created_at) values (?, ?)')
    .run('task', new Date().toISOString())
  let eid = Number(lastInsertRowid)
  db.prepare('insert into task (eid, title, status, body) values (?, ?, ?, ?)')
    .run(eid, title, status, body)
  return eid
}

let link = (db: DatabaseSync, src: number, dst: number, type: Edge) =>
  db.prepare(
    'insert into dependencies (src_eid, dst_eid, type) values (?, ?, ?)',
  ).run(src, dst, type)

// A handful of rows, including at least one edge of each type, so the index
// route has a real graph to render.
let seed = (db: DatabaseSync) => {
  let scaffold = addTask(
    db,
    'Scaffold Tasks v2',
    'wip',
    'Fresh + SQLite walking skeleton: the ECS star planted as seed schema.',
  )
  let loop = addTask(
    db,
    'Injection loop: task context + SessionStart hook',
    'open',
    'The keystone — once it closes, tasks stop disappearing by construction.',
  )
  let ids = addTask(
    db,
    'Universal typed ids (T-123, C-123)',
    'open',
    'Per-type counters over entity kinds; slugs stay as aliases.',
  )
  let design = addTask(
    db,
    'Design: tasks as working memory',
    'open',
    'The task graph must BE the retrieval path, not a side-channel tracker.',
  )
  link(db, loop, scaffold, 'blocks') // loop is gated by the skeleton
  link(db, ids, loop, 'subtask') // typed ids decompose the loop epic
  link(db, design, scaffold, 'informs') // read the design before building
}

// Open the file, plant the schema, seed once if the graph is empty. Returns a
// live handle; the process holds it open for the server's lifetime.
export let open = () => {
  Deno.mkdirSync('./data', { recursive: true })
  let db = new DatabaseSync(file)
  db.exec(schema)
  let { n } = db.prepare('select count(*) as n from task').get() as {
    n: number
  }
  if (!n) seed(db)
  return db
}

// A task joined to its entity spine, newest first.
export let tasks = (db: DatabaseSync) =>
  db.prepare(`
    select t.eid, t.title, t.status, t.body, e.created_at
    from task t join entities e on e.eid = t.eid
    order by e.eid
  `).all() as Task[]

// Every edge, as {src, dst, type} — the graph the index route draws.
export let deps = (db: DatabaseSync) =>
  db.prepare(
    'select src_eid as src, dst_eid as dst, type from dependencies',
  ).all() as Dep[]

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  let db = open()
  console.log(`seeded ${tasks(db).length} tasks, ${deps(db).length} edges`)
}
