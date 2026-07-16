// The fleet entity graph, in one SQLite file. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, `project`, `card`, …)
// hang off it by that same id; `dependency` rows are typed eid↔eid edges that
// read as sentences. This module owns the file + seed; routes read.
//
// Ids: `eid` is a UUID so ANY side (client included) can mint entities;
// `num` is the server-minted human number (T-7 in the UI, one global counter).
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
  eid: string
  title: string
  status: string
  body: string
}

export type Proj = { eid: string; title: string }
export type Card = { eid: string; target_eid: string; view: string }
export type Pin = {
  eid: string
  canvas_eid: string
  x: number
  y: number
  w: number
  h: number
}

// A browser identity: its uuid is minted client-side into localStorage on
// first visit. ip is server-stamped (a client can't self-report one).
export type Client = {
  eid: string
  user_agent: string
  ip: string
}

// A camera joins a client to a canvas: per-client pan/zoom, one row per
// (client, canvas) pair — canvases nest, so this is NOT keyed by the client.
// x/y is the viewport CENTER in plane coords; w/h is the viewport size in
// screen px, stored so other clients can render each other's viewports.
export type Camera = {
  eid: string
  client_eid: string
  canvas_eid: string
  x: number
  y: number
  zoom: number
  w: number
  h: number
}

export type Dep = { parent: string; type: Edge; child: string }

// An outgoing edge, verb + child — the Dependency view resolves the name.
export type Ref = { type: Edge; child: string }

// The bundle a renderer pattern-matches on: the entity plus whichever
// components it carries, its edge sentences, and the entities it contains.
export type Ent = {
  eid: string
  num: number
  kind: string
  task?: Task
  project?: Proj
  card?: Card
  pin?: Pin
  client?: Client
  camera?: Camera
  refs: Ref[]
  kids: Ent[]
}

// A pin row joined to its card: where the card sits and what it shows.
export type Pinned = Pin & { target_eid: string; view: string }

// The star: an entity spine plus one component table per kind, plus the edge
// table. `if not exists` makes this idempotent — safe to run every boot.
// A canvas is an entity with no component (yet) — its geometry lives in `pin`.
let schema = `
  create table if not exists entity (
    eid        text primary key,
    num        integer not null unique,
    kind       text not null,
    created_at text not null
  );
  create table if not exists task (
    eid    text primary key references entity(eid),
    title  text not null,
    status text not null,
    body   text not null default ''
  );
  create table if not exists project (
    eid   text primary key references entity(eid),
    title text not null
  );
  create table if not exists card (
    eid        text primary key references entity(eid),
    target_eid text not null references entity(eid),
    view       text not null
  );
  create table if not exists pin (
    eid        text primary key references card(eid),
    canvas_eid text not null references entity(eid),
    x integer not null,
    y integer not null,
    w integer not null,
    h integer not null
  );
  create table if not exists client (
    eid        text primary key references entity(eid),
    user_agent text not null default '',
    ip         text not null default ''
  );
  create table if not exists camera (
    eid        text primary key references entity(eid),
    client_eid text not null references entity(eid),
    canvas_eid text not null references entity(eid),
    x    real not null default 0,
    y    real not null default 0,
    zoom real not null default 1,
    w    real not null default 0,
    h    real not null default 0,
    unique (client_eid, canvas_eid)
  );
  create table if not exists dependency (
    parent_eid text not null references entity(eid),
    type       text not null check (type in ('requires','contains','reads')),
    child_eid  text not null references entity(eid),
    primary key (parent_eid, type, child_eid)
  );
`

// Insert an entity spine row: the eid arrives (or is minted) as a UUID, the
// num is minted HERE — one global counter, safe inside a transaction.
let spine = (db: DatabaseSync, eid: string, kind: string) =>
  db.prepare(`
    insert or ignore into entity (eid, num, kind, created_at)
    values (?, (select coalesce(max(num), 0) + 1 from entity), ?, ?)
  `).run(eid, kind, new Date().toISOString())

// Mint a bare entity of a kind; components hang off the returned eid.
let ent = (db: DatabaseSync, kind: string) => {
  let eid = crypto.randomUUID()
  spine(db, eid, kind)
  return eid
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
let addCard = (db: DatabaseSync, target: string, view: string) => {
  let eid = ent(db, 'card')
  db.prepare('insert into card (eid, target_eid, view) values (?, ?, ?)')
    .run(eid, target, view)
  return eid
}

let pin = (
  db: DatabaseSync,
  canvas: string,
  card: string,
  x: number,
  y: number,
  w: number,
  h: number,
) =>
  db.prepare(
    'insert into pin (eid, canvas_eid, x, y, w, h) values (?, ?, ?, ?, ?, ?)',
  ).run(card, canvas, x, y, w, h)

let link = (db: DatabaseSync, parent: string, type: Edge, child: string) =>
  db.prepare(
    'insert into dependency (parent_eid, type, child_eid) values (?, ?, ?)',
  ).run(parent, type, child)

// A handful of neutral demo rows — a project containing tasks, one edge of
// each type, and a root canvas showing the project as a Board plus one task
// card. No fleet data in the repo.
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

// The one live handle — routes and views share it for the process lifetime.
export let db = open()

// The whole entity, assembled for a renderer: entity row, components present,
// outgoing edge sentences, contained children (recursive — graphs stay small;
// a view reads as deep as it wants).
export let bundle = (db: DatabaseSync, eid: string): Ent => {
  let e = db.prepare('select eid, num, kind from entity where eid = ?')
    .get(eid) as { eid: string; num: number; kind: string }
  let comp = <T>(table: string) =>
    db.prepare(`select * from ${table} where eid = ?`).get(eid) as
      | T
      | undefined
  let refs = db.prepare(`
    select type, child_eid as child from dependency
    where parent_eid = ? and type != 'contains'
  `).all(eid) as Ref[]
  let kids = (db.prepare(`
    select child_eid from dependency
    where parent_eid = ? and type = 'contains'
  `).all(eid) as { child_eid: string }[])
    .map((r) => bundle(db, r.child_eid))
  return {
    ...e,
    task: comp<Task>('task'),
    project: comp<Proj>('project'),
    card: comp<Card>('card'),
    pin: comp<Pin>('pin'),
    client: comp<Client>('client'),
    camera: comp<Camera>('camera'),
    refs,
    kids,
  }
}

// A client's camera over one canvas, for restoring pan/zoom on page load.
export let camera = (db: DatabaseSync, client: string, canvas: string) =>
  db.prepare('select * from camera where client_eid = ? and canvas_eid = ?')
    .get(client, canvas) as Camera | undefined

// Point a card at a different lens — the tab click's write.
export let setView = (db: DatabaseSync, card: string, view: string) =>
  db.prepare('update card set view = ? where eid = ?').run(view, card)

// The root canvas (first canvas entity) and the cards pinned to a canvas.
export let rootCanvas = (db: DatabaseSync) =>
  db.prepare("select eid from entity where kind = 'canvas' order by num")
    .get() as { eid: string }

export let pinned = (db: DatabaseSync, canvas: string) =>
  db.prepare(`
    select p.eid, p.canvas_eid, p.x, p.y, p.w, p.h, c.target_eid, c.view
    from pin p join card c on c.eid = p.eid
    where p.canvas_eid = ?
    order by p.eid
  `).all(canvas) as Pinned[]

// A task joined to its entity spine, oldest first.
export let tasks = (db: DatabaseSync) =>
  db.prepare(`
    select t.eid, t.title, t.status, t.body
    from task t join entity e on e.eid = t.eid
    order by e.num
  `).all() as Task[]

// Every edge, as {parent, type, child} — each row IS the sentence.
export let deps = (db: DatabaseSync) =>
  db.prepare(
    'select parent_eid as parent, type, child_eid as child from dependency',
  ).all() as Dep[]

// The sync unit — one component patch landing on (or leaving) an entity. A
// batch is a flat array; a comp is a PATCH: omitted columns are untouched
// (a single prop change sends a single prop), `prop: null` clears that
// column, comp: null deletes the component, and {name: 'entity', comp: null}
// deletes the entity, its components, and every edge touching it. Deleting a
// bunch is just a long batch. Client-minted UUID eids are welcome — the
// spine (and its num) appears on first touch.
export type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
}

// The component tables the sync layer may write, with their writable columns.
let cmps: Record<string, string[]> = {
  entity: ['kind'],
  task: ['title', 'status', 'body'],
  project: ['title'],
  card: ['target_eid', 'view'],
  pin: ['canvas_eid', 'x', 'y', 'w', 'h'],
  client: ['user_agent'], // ip is server-stamped, never writable over the wire
  camera: ['client_eid', 'canvas_eid', 'x', 'y', 'zoom', 'w', 'h'],
}

// Apply a batch atomically. Unknown component names are ignored (a newer
// client speaking to an older server shouldn't wedge the socket). num and
// created_at are server-owned — never writable over the wire.
export let apply = (db: DatabaseSync, changes: Change[]) => {
  db.exec('begin')
  try {
    for (let { eid, name, comp } of changes) {
      let cols = cmps[name]
      if (!cols) continue
      if (comp == null) {
        if (name == 'entity') {
          for (let t of Object.keys(cmps)) {
            if (t != 'entity') {
              db.prepare(`delete from ${t} where eid = ?`).run(eid)
            }
          }
          db.prepare(
            'delete from dependency where parent_eid = ? or child_eid = ?',
          ).run(eid, eid)
        }
        db.prepare(`delete from ${name} where eid = ?`).run(eid)
        continue
      }
      if (name == 'entity') {
        spine(db, eid, String(comp.kind ?? 'entity'))
        if ('kind' in comp) {
          db.prepare('update entity set kind = ? where eid = ?')
            .run(String(comp.kind), eid)
        }
        continue
      }
      spine(db, eid, name)
      let sent = cols.filter((c) => c in comp)
      let vals = sent.map((c) => comp[c] as string | number | null)
      // Update first (a patch can't re-satisfy not-null columns an insert
      // would demand); insert only when the row doesn't exist yet — creating
      // one is the moment its required columns are due.
      let hit = sent.length
        ? db.prepare(
          `update ${name} set ${sent.map((c) => `${c} = ?`).join(', ')}
           where eid = ?`,
        ).run(...vals, eid).changes
        : 0
      if (!hit && sent.length) {
        db.prepare(
          `insert into ${name} (eid${sent.map((c) => `, ${c}`).join('')})
           values (?${', ?'.repeat(sent.length)})`,
        ).run(eid, ...vals)
      } else if (!sent.length) {
        // A bare {} touch: create with defaults if possible, else no-op.
        db.prepare(`insert or ignore into ${name} (eid) values (?)`).run(eid)
      }
    }
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  console.log(`seeded ${tasks(db).length} tasks, ${deps(db).length} edges`)
}
