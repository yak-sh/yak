// The fleet entity graph, in one SQLite file. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, …) hang off it by that
// same id; `dependency` rows are typed eid↔eid edges — anything can block,
// contain, or inform anything. This module owns the file + seed; routes read.
import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'

// The db lives outside the repo (this is open source): a home-dir dotpath by
// default, overridable with DB_PATH.
let file = Deno.env.get('DB_PATH') ??
  `${Deno.env.get('HOME')}/.tasks/tasks.db`

// The edge vocabulary. blocks = hard gate, contains = decomposition (parent
// rolls up), informs = read-first, never gates.
export type Edge = 'blocks' | 'contains' | 'informs'

export type Task = {
  eid: number
  title: string
  status: string
  body: string
  created_at: string
}

export type Dep = { parent: number; child: number; type: Edge }

// The star: an entity spine plus one component table per kind, plus the edge
// table. `if not exists` makes this idempotent — safe to run every boot.
let schema = `
  create table if not exists entity (
    eid        integer primary key autoincrement,
    kind       text not null,
    created_at text not null
  );
  create table if not exists task (
    eid    integer primary key references entity(eid),
    title  text not null,
    status text not null,
    body   text not null default ''
  );
  create table if not exists dependency (
    parent_eid integer not null references entity(eid),
    child_eid integer not null references entity(eid),
    type    text not null check (type in ('blocks','contains','informs')),
    primary key (parent_eid, child_eid, type)
  );
`

// Copy-tweak-return: mint an entity, hang a task component on it, hand back the
// eid so the caller can wire edges to it.
let addTask = (db: DatabaseSync, title: string, status: string, body = '') => {
  let { lastInsertRowid } = db
    .prepare('insert into entity (kind, created_at) values (?, ?)')
    .run('task', new Date().toISOString())
  let eid = Number(lastInsertRowid)
  db.prepare('insert into task (eid, title, status, body) values (?, ?, ?, ?)')
    .run(eid, title, status, body)
  return eid
}

let link = (db: DatabaseSync, parent: number, child: number, type: Edge) =>
  db.prepare(
    'insert into dependency (parent_eid, child_eid, type) values (?, ?, ?)',
  ).run(parent, child, type)

// A handful of neutral demo rows, one edge of each type and one of each status,
// so the index route has a real graph to render — no fleet data in the repo.
let seed = (db: DatabaseSync) => {
  let schema = addTask(
    db,
    'Set up the database schema',
    'done',
    'Model the entities and how they relate.',
  )
  let view = addTask(
    db,
    'Build the task list view',
    'wip',
    'Render each task with its dependencies.',
  )
  let keys = addTask(
    db,
    'Add keyboard shortcuts',
    'open',
    'Navigate the list without reaching for the mouse.',
  )
  let readme = addTask(
    db,
    'Write the README',
    'open',
    'Explain the schema and how to run the app.',
  )
  link(db, view, schema, 'blocks') // the view is gated by the schema
  link(db, view, keys, 'contains') // the view work decomposes into shortcuts
  link(db, readme, schema, 'informs') // read the schema before writing docs
}

// Open the file, plant the schema, seed once if the graph is empty. Returns a
// live handle; the process holds it open for the server's lifetime.
export let open = () => {
  Deno.mkdirSync(dirname(file), { recursive: true })
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
    from task t join entity e on e.eid = t.eid
    order by e.eid
  `).all() as Task[]

// Every edge, as {parent, child, type}. The parent depends on its children:
// children block the parent, the parent contains its containss.
export let deps = (db: DatabaseSync) =>
  db.prepare(
    'select parent_eid as parent, child_eid as child, type from dependency',
  ).all() as Dep[]

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  let db = open()
  console.log(`seeded ${tasks(db).length} tasks, ${deps(db).length} edges`)
}
