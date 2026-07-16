// The fleet entity graph, in one SQLite file. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, `project`, `card`, …)
// hang off it by that same id; `dependency` rows are typed eid↔eid edges that
// read as sentences. This module owns the file, the seed, and the two wire
// operations: apply (patch batches in) and snapshot (the whole graph out).
// SERVER-ONLY — the browser reads the graph from its cache in live.ts.
//
// Ids: `eid` is a UUID so ANY side (client included) can mint entities;
// `num` is the server-minted human number (T-7 in the UI, one global counter).
import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'
import { type Change, type Dep, type Snapshot } from './types.ts'

// The db lives outside the repo (this is open source): a home-dir dotpath by
// default, overridable with DB_PATH.
let file = Deno.env.get('DB_PATH') ??
  `${Deno.env.get('HOME')}/.tasks/tasks.db`

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
    h integer not null,
    z integer not null default 0
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
  create table if not exists tombstone (
    eid        text primary key,
    deleted_at text not null
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

let link = (db: DatabaseSync, parent: string, type: string, child: string) =>
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
// Additive migrations: `create if not exists` won't grow an existing table,
// so new columns are altered in when missing.
let migrate = (db: DatabaseSync) => {
  let has = (table: string, col: string) =>
    (db.prepare(
      'select count(*) as n from pragma_table_info(?) where name = ?',
    ).get(table, col) as { n: number }).n
  if (!has('pin', 'z')) {
    db.exec('alter table pin add column z integer not null default 0')
  }
}

export let open = () => {
  Deno.mkdirSync(dirname(file), { recursive: true })
  let db = new DatabaseSync(file)
  db.exec(schema)
  migrate(db)
  let { n } = db.prepare('select count(*) as n from task').get() as {
    n: number
  }
  if (!n) seed(db)
  return db
}

// The one live handle — the server shares it for the process lifetime.
export let db = open()

// The component tables the sync layer may write, with their writable columns.
let cmps: Record<string, string[]> = {
  entity: ['kind'],
  task: ['title', 'status', 'body'],
  project: ['title'],
  card: ['target_eid', 'view'],
  pin: ['canvas_eid', 'x', 'y', 'w', 'h', 'z'],
  client: ['user_agent'], // ip is server-stamped, never writable over the wire
  camera: ['client_eid', 'canvas_eid', 'x', 'y', 'zoom', 'w', 'h'],
}

// Apply a batch atomically. Unknown component names are ignored (a newer
// client speaking to an older server shouldn't wedge the socket). num and
// created_at are server-owned — never writable over the wire.
export let apply = (db: DatabaseSync, changes: Change[]) => {
  let dead = db.prepare('select 1 from tombstone where eid = ?')
  db.exec('begin')
  try {
    for (let { eid, name, comp } of changes) {
      let cols = cmps[name]
      if (!cols) continue
      // A deleted entity stays deleted: the tombstone voids every late or
      // replayed change for its eid — an edit racing a delete loses
      // deterministically, and nothing can resurrect the id.
      if (dead.get(eid)) continue
      if (comp == null) {
        if (name == 'entity') {
          // Reverse declaration order so dependents go before what they
          // reference (pin → card must delete pin first).
          for (let t of Object.keys(cmps).toReversed()) {
            if (t != 'entity') {
              db.prepare(`delete from ${t} where eid = ?`).run(eid)
            }
          }
          db.prepare(
            'delete from dependency where parent_eid = ? or child_eid = ?',
          ).run(eid, eid)
          db.prepare(
            'insert or ignore into tombstone (eid, deleted_at) values (?, ?)',
          ).run(eid, new Date().toISOString())
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
      let sent = cols.filter((c) => c in comp)
      let vals = sent.map((c) => comp[c] as string | number | null)
      // Update first (a patch can't re-satisfy not-null columns an insert
      // would demand). An existing row implies an existing spine.
      let hit = sent.length
        ? db.prepare(
          `update ${name} set ${sent.map((c) => `${c} = ?`).join(', ')}
           where eid = ?`,
        ).run(...vals, eid).changes
        : 0
      if (hit) continue
      // No row: this change CREATES — spine + comp together, in a savepoint.
      // A partial patch whose row is gone is an edit racing a delete: the
      // delete wins, the change rolls back to nothing (no zombie spine) and
      // the rest of the batch survives. A malformed create fails the same
      // way, loudly in the log.
      db.exec('savepoint change')
      try {
        spine(db, eid, name)
        if (sent.length) {
          db.prepare(
            `insert into ${name} (eid${sent.map((c) => `, ${c}`).join('')})
             values (?${', ?'.repeat(sent.length)})`,
          ).run(eid, ...vals)
        } else {
          // A bare {} touch: create with defaults if possible, else no-op.
          db.prepare(`insert or ignore into ${name} (eid) values (?)`).run(eid)
        }
        db.exec('release change')
      } catch (e) {
        db.exec('rollback to change')
        db.exec('release change')
        console.warn(`sync: change for ${name} ${eid} dropped —`, e)
      }
    }
    db.exec('commit')
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}

// The whole graph as one batch (plus edges) — what a fresh client cache eats.
// Entity comps carry num/created_at OUT; apply() never lets them back IN.
export let snapshot = (db: DatabaseSync): Snapshot => {
  let changes: Change[] = []
  for (
    let name of [
      'entity',
      ...Object.keys(cmps).filter((n) => n != 'entity'),
    ]
  ) {
    for (
      let row of db.prepare(`select * from ${name}`).all() as Record<
        string,
        unknown
      >[]
    ) {
      changes.push({ eid: row.eid as string, name, comp: row })
    }
  }
  let deps = db.prepare(
    'select parent_eid as parent, type, child_eid as child from dependency',
  ).all() as Dep[]
  return { changes, deps }
}

// `deno task seed` (or a direct run) bootstraps the file without the server.
if (import.meta.main) {
  let n = (q: string) => (db.prepare(q).get() as { n: number }).n
  console.log(
    `seeded ${n('select count(*) as n from task')} tasks, ${
      n('select count(*) as n from dependency')
    } edges`,
  )
}
