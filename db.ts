// The fleet entity graph, in one SQLite file. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, `project`, `card`, …)
// hang off it by that same id; `dependency` rows are typed eid↔eid edges that
// read as sentences. This module owns the file + seed; routes read.
import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'

// The db lives outside the repo (this is open source): a home-dir dotpath by
// default, overridable with DB_PATH.
let file = Deno.env.get('DB_PATH') ??
  `${Deno.env.get('HOME')}/.tasks/tasks.db`

// The edge vocabulary — every edge reads as a sentence, parent first:
// parent requires child (hard gate) · parent contains child (decomposition,
// children roll up) · parent reads child (read-first, never gates).
export type Edge = 'requires' | 'contains' | 'reads'

export type Task = {
  eid: number
  title: string
  status: string
  body: string
}

export type Proj = { eid: number; title: string }
export type Card = { eid: number; target_eid: number; view: string }

export type Dep = { parent: number; type: Edge; child: number }

// An outgoing edge with its child resolved to a printable name — the sentence
// a renderer draws ("requires Set up the database schema").
export type Ref = { type: Edge; child: number; name: string }

// The bundle a renderer pattern-matches on: the entity plus whichever
// components it carries, its edge sentences, and the entities it contains.
export type Ent = {
  eid: number
  kind: string
  task?: Task
  project?: Proj
  card?: Card
  refs: Ref[]
  kids: Ent[]
}

// A pin row joined to its card: where the card sits and what it shows.
export type Pinned = {
  card_eid: number
  target_eid: number
  view: string
  x: number
  y: number
  w: number
  h: number
}

// The star: an entity spine plus one component table per kind, plus the edge
// table. `if not exists` makes this idempotent — safe to run every boot.
// A canvas is an entity with no component (yet) — its geometry lives in `pin`.
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
  create table if not exists project (
    eid   integer primary key references entity(eid),
    title text not null
  );
  create table if not exists card (
    eid        integer primary key references entity(eid),
    target_eid integer not null references entity(eid),
    view       text not null
  );
  create table if not exists pin (
    canvas_eid integer not null references entity(eid),
    card_eid   integer not null references card(eid),
    x integer not null,
    y integer not null,
    w integer not null,
    h integer not null,
    primary key (canvas_eid, card_eid)
  );
  create table if not exists dependency (
    parent_eid integer not null references entity(eid),
    type       text not null check (type in ('requires','contains','reads')),
    child_eid  integer not null references entity(eid),
    primary key (parent_eid, type, child_eid)
  );
`

// Mint a bare entity of a kind; components hang off the returned eid.
let ent = (db: DatabaseSync, kind: string) => {
  let { lastInsertRowid } = db
    .prepare('insert into entity (kind, created_at) values (?, ?)')
    .run(kind, new Date().toISOString())
  return Number(lastInsertRowid)
}

let addTask = (db: DatabaseSync, title: string, status: string, body = '') => {
  let eid = ent(db, 'task')
  db.prepare('insert into task (eid, title, status, body) values (?, ?, ?, ?)')
    .run(eid, title, status, body)
  return eid
}

let addProject = (db: DatabaseSync, title: string) => {
  let eid = ent(db, 'project')
  db.prepare('insert into project (eid, title) values (?, ?)').run(eid, title)
  return eid
}

// A card views one entity through one lens; pinning places it on a canvas.
let addCard = (db: DatabaseSync, target: number, view: string) => {
  let eid = ent(db, 'card')
  db.prepare('insert into card (eid, target_eid, view) values (?, ?, ?)')
    .run(eid, target, view)
  return eid
}

let pin = (
  db: DatabaseSync,
  canvas: number,
  card: number,
  x: number,
  y: number,
  w: number,
  h: number,
) =>
  db.prepare(
    'insert into pin (canvas_eid, card_eid, x, y, w, h) values (?, ?, ?, ?, ?, ?)',
  ).run(canvas, card, x, y, w, h)

let link = (db: DatabaseSync, parent: number, type: Edge, child: number) =>
  db.prepare(
    'insert into dependency (parent_eid, type, child_eid) values (?, ?, ?)',
  ).run(parent, type, child)

// A handful of neutral demo rows — a project containing tasks, one edge of
// each type, and a root canvas showing the same project through two lenses.
// No fleet data in the repo.
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
  link(db, view, 'requires', schema) // the view is gated by the schema
  link(db, view, 'contains', keys) // the view work decomposes into shortcuts
  link(db, readme, 'reads', schema) // read the schema before writing docs

  let proj = addProject(db, 'Walking skeleton')
  for (let t of [schema, view, keys, readme]) link(db, proj, 'contains', t)

  let canvas = ent(db, 'canvas')
  pin(db, canvas, addCard(db, proj, 'Board'), 0, 0, 640, 0)
  pin(db, canvas, addCard(db, view, 'Task'), 664, 0, 320, 0)
  pin(db, canvas, addCard(db, proj, 'JSON'), 664, 200, 320, 0)
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

// The whole entity, assembled for a renderer: entity row, components present,
// outgoing edge sentences, contained children (recursive — graphs stay small;
// a view reads as deep as it wants).
export let bundle = (db: DatabaseSync, eid: number): Ent => {
  let e = db.prepare('select eid, kind from entity where eid = ?')
    .get(eid) as { eid: number; kind: string }
  let comp = <T>(table: string) =>
    db.prepare(`select * from ${table} where eid = ?`).get(eid) as
      | T
      | undefined
  let refs = db.prepare(`
    select d.type, d.child_eid as child,
           coalesce(t.title, p.title, c.kind) as name
    from dependency d
    join entity c on c.eid = d.child_eid
    left join task t on t.eid = d.child_eid
    left join project p on p.eid = d.child_eid
    where d.parent_eid = ? and d.type != 'contains'
  `).all(eid) as Ref[]
  let kids = (db.prepare(`
    select child_eid from dependency
    where parent_eid = ? and type = 'contains'
  `).all(eid) as { child_eid: number }[])
    .map((r) => bundle(db, r.child_eid))
  return {
    ...e,
    task: comp<Task>('task'),
    project: comp<Proj>('project'),
    card: comp<Card>('card'),
    refs,
    kids,
  }
}

// The root canvas (first canvas entity) and the cards pinned to a canvas.
export let rootCanvas = (db: DatabaseSync) =>
  db.prepare("select eid from entity where kind = 'canvas' order by eid")
    .get() as { eid: number }

export let pinned = (db: DatabaseSync, canvas: number) =>
  db.prepare(`
    select p.card_eid, c.target_eid, c.view, p.x, p.y, p.w, p.h
    from pin p join card c on c.eid = p.card_eid
    where p.canvas_eid = ?
    order by p.card_eid
  `).all(canvas) as Pinned[]

// A task joined to its entity spine, oldest first.
export let tasks = (db: DatabaseSync) =>
  db.prepare(`
    select t.eid, t.title, t.status, t.body
    from task t join entity e on e.eid = t.eid
    order by e.eid
  `).all() as Task[]

// Every edge, as {parent, type, child} — each row IS the sentence.
export let deps = (db: DatabaseSync) =>
  db.prepare(
    'select parent_eid as parent, type, child_eid as child from dependency',
  ).all() as Dep[]

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  let db = open()
  console.log(`seeded ${tasks(db).length} tasks, ${deps(db).length} edges`)
}
