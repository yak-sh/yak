// The fleet entity graph, in one SQLite file. Star ECS: `entity` holds the
// shared primary key (`eid`); component tables (`task`, `board`, `card`, …)
// hang off it by that same id; `dependency` rows are typed eid↔eid edges that
// read as sentences. This module owns the file, the seed, and the two wire
// operations: apply (patch batches in) and snapshot (the whole graph out).
// SERVER-ONLY — the browser reads the graph from its cache in live.ts.
//
// Ids: `eid` is a UUID so ANY side (client included) can mint entities;
// `num` is the server-minted human number (T-7 in the UI, one global counter).
import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'
import {
  type Change,
  comps,
  deaths,
  type Dep,
  edges,
  type Hit,
  kindOrder,
  sessionActive,
  type Snapshot,
} from './types.ts'
import { type Trace } from './effects.ts'
import { matchQuery, parseQuery, resolveRefs, TEXT } from './query.ts'

// The db lives outside the repo (this is open source): a home-dir dotpath by
// default, overridable with DB_PATH.
let file = Deno.env.get('DB_PATH') ??
  `${Deno.env.get('HOME')}/.tasks/tasks.db`

// The edge table's check derives from the vocabulary (types.ts `edges`),
// so a new verb there is a new verb here with no second edit. Named apart
// from `schema` because open() also needs it to REBUILD a live table
// whose baked check has fallen behind — a check can't be widened in place.
let depDdl = `create table if not exists dependency (
    parent_eid text not null references entity(eid),
    type       text not null check (type in (${
  edges.map((e) => `'${e}'`).join(',')
})),
    child_eid  text not null references entity(eid),
    primary key (parent_eid, type, child_eid)
  )`

// The star: an entity spine plus one component table per kind, plus the edge
// table. `if not exists` makes this idempotent — safe to run every boot.
// A canvas is an entity with no component (yet) — its geometry lives in `pin`.
let schema = `
  create table if not exists entity (
    eid         text primary key,
    num         integer not null unique,
    created_at  text not null,
    modified_at text
  );
  create table if not exists canvas (
    eid text primary key references entity(eid)
  );
  create table if not exists doc (
    eid   text primary key references entity(eid),
    title text not null,
    body  text not null default ''
  );
  create table if not exists task (
    eid    text primary key references entity(eid),
    status text not null default 'open',
    priority real not null default 0
  );
  create table if not exists project (
    eid text primary key references entity(eid),
    retired_at text
  );
  create table if not exists person (
    eid text primary key references entity(eid)
  );
  create table if not exists persona (
    eid text primary key references entity(eid),
    home_eid text references entity(eid)
  );
  create table if not exists repo (
    eid  text primary key references entity(eid),
    path text not null,
    base_branch text not null default 'main'
  );
  create table if not exists board (
    eid text primary key references entity(eid)
  );
  create table if not exists web (
    eid text primary key references entity(eid),
    url text not null,
    frozen_at text
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
  create table if not exists fold (
    eid        text primary key references entity(eid),
    client_eid text not null references entity(eid),
    board_eid  text not null references entity(eid),
    statuses   text not null default '',
    unique (client_eid, board_eid)
  );
  create table if not exists shelf (
    eid        text primary key references entity(eid),
    client_eid text not null references entity(eid),
    unique (client_eid)
  );
  create table if not exists session (
    eid text primary key references entity(eid),
    id  text not null unique,
    cwd text
  );
  create table if not exists claim (
    eid         text primary key references entity(eid),
    session_eid text not null references entity(eid),
    claimed_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table if not exists stop_request (
    eid        text primary key references entity(eid),
    target_eid text not null references entity(eid),
    acted_at   text
  );
  -- Outbound mail. "to"/"from" are SQL keywords — quoted here and by the
  -- generic builders in apply(), which quote every column so the
  -- vocabulary never bends to SQL's reserved words.
  create table if not exists mail (
    eid        text primary key references entity(eid),
    "to"       text not null,
    "from"     text,
    target_eid text references entity(eid),
    acted_at   text,
    error      text,
    to_addr    text
  );
  -- Inbound webhook deliveries, derived from the edge's raw request
  -- spool (inbound.ts). Every column is server-stamped; the wire can
  -- only aim docs and comments at a hook, never write one.
  create table if not exists hook (
    eid         text primary key references entity(eid),
    source      text,
    event       text,
    payload     text,
    spool_id    text,
    received_at text
  );
  create table if not exists email (
    eid     text primary key references entity(eid),
    address text not null
  );
  create table if not exists conflict (
    eid        text primary key references entity(eid),
    target_eid text not null,
    loser      text not null,
    holder     text not null,
    at         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table if not exists comment (
    eid        text primary key references entity(eid),
    target_eid text not null references entity(eid),
    author_eid text
  );
  create table if not exists alias (
    eid  text primary key references entity(eid),
    slug text not null unique
  );
  create table if not exists memory (
    eid         text primary key references entity(eid),
    type        text not null default 'project',
    source_eid  text,
    scope_eid   text,
    last_confirmed_at text
  );
  -- recall's not-null columns have no defaults ON PURPOSE: they refuse
  -- even apply()'s bare {} touch, so touch() below stays the one writer.
  create table if not exists recall (
    eid      text primary key references entity(eid),
    count    integer not null default 1,
    first_at text not null,
    last_at  text not null
  );
  create table if not exists tombstone (
    eid        text primary key,
    num        integer,
    deleted_at text not null
  );
  ${depDdl};
  -- Log data, not graph (like tool_call below): the journal is the record
  -- OF the wire, never part of it — one row per applied batch, written
  -- inside apply()'s transaction. No eid of its own, never in snapshot(),
  -- never in a client cache; read it per-entity via journalOf(). The
  -- symmetry: telemetry records READS, the journal records WRITES.
  create table if not exists journal (
    ts    text not null
          default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actor text,
    batch text not null
  );
  -- Log data, not graph: no eid, no components, so snapshot() (which walks
  -- the comps vocabulary) never carries it. telemetry.ts owns the rows.
  create table if not exists tool_call (
    ts         text not null
               default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source     text not null check (source in ('mcp','http','web')),
    name       text not null,
    session_id text,
    ok         integer not null,
    ms         integer,
    error      text,
    detail     text
  );
  create virtual table if not exists doc_fts using fts5(
    title, body, content='doc', content_rowid='rowid'
  );
  create trigger if not exists doc_fts_ai after insert on doc begin
    insert into doc_fts (rowid, title, body)
    values (new.rowid, new.title, new.body);
  end;
  create trigger if not exists doc_fts_ad after delete on doc begin
    insert into doc_fts (doc_fts, rowid, title, body)
    values ('delete', old.rowid, old.title, old.body);
  end;
  create trigger if not exists doc_fts_au after update on doc begin
    insert into doc_fts (doc_fts, rowid, title, body)
    values ('delete', old.rowid, old.title, old.body);
    insert into doc_fts (rowid, title, body)
    values (new.rowid, new.title, new.body);
  end;
`

// Insert an entity spine row: the eid arrives (or is minted) as a UUID, the
// num is minted HERE — one global counter, safe inside a transaction.
// The max spans the graves too: nums are monotonic forever, or a deleted
// T-3889's number is reborn on a stranger and every old reference lies.
// No kind: an entity is what its components make it.
let spine = (db: DatabaseSync, eid: string) => {
  let now = new Date().toISOString()
  return db.prepare(`
    insert or ignore into entity (eid, num, created_at, modified_at)
    values (?, (select coalesce(max(num), 0) + 1 from
      (select num from entity union all select num from tombstone)), ?, ?)
  `).run(eid, now, now)
}

// Mint a bare entity; components hang off the returned eid.
let ent = (db: DatabaseSync) => {
  let eid = crypto.randomUUID()
  spine(db, eid)
  return eid
}

let doc = (db: DatabaseSync, eid: string, title: string, body = '') =>
  db.prepare('insert into doc (eid, title, body) values (?, ?, ?)')
    .run(eid, title, body)

let addTask = (db: DatabaseSync, title: string, status: string, body = '') => {
  let eid = ent(db)
  doc(db, eid, title, body)
  db.prepare('insert into task (eid, status) values (?, ?)').run(eid, status)
  return eid
}

let addProject = (db: DatabaseSync, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  db.prepare('insert into project (eid) values (?)').run(eid)
  return eid
}

let addBoard = (db: DatabaseSync, title: string) => {
  let eid = ent(db)
  doc(db, eid, title)
  db.prepare('insert into board (eid) values (?)').run(eid)
  return eid
}

// A card views one entity through one lens; pinning places it on a canvas.
let addCard = (db: DatabaseSync, target: string, view: string) => {
  let eid = ent(db)
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

// A handful of neutral demo rows — a board containing tasks, one edge of
// each type, and a root canvas showing it as a Board plus one task
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

  let board = addBoard(db, 'Walking skeleton')
  for (let t of [schema, view, keys, readme]) link(db, board, 'contains', t)

  let proj = addProject(db, 'Demo project')
  db.prepare('update task set project_eid = ?').run(proj)

  let canvas = ent(db)
  db.prepare('insert into canvas (eid) values (?)').run(canvas)
  pin(db, canvas, addCard(db, board, 'Board'), 0, 0, 640, 0)
  pin(db, canvas, addCard(db, view, 'Task'), 664, 0, 320, 0)
}

// Open the file, plant the schema, seed once if the graph is empty.
// Returns a live handle; the process holds it open for the server's
// lifetime. No real migrations: NEW columns are added in place (additive,
// no data moves); anything shapier still means export/reseed.
export let open = () => {
  Deno.mkdirSync(dirname(file), { recursive: true })
  let db = new DatabaseSync(file)
  db.exec(schema)
  let addCol = (table: string, col: string, ddl: string) => {
    let cols = db.prepare(`select name from pragma_table_info('${table}')`)
      .all() as { name: string }[]
    if (!cols.some((c) => c.name == col)) {
      db.exec(`alter table ${table} add column ${ddl}`)
    }
  }
  addCol('task', 'project_eid', 'project_eid text references entity(eid)')
  addCol('task', 'assignee_eid', 'assignee_eid text references entity(eid)')
  addCol('task', 'domain', 'domain text')
  addCol('session', 'cwd', 'cwd text')
  addCol('session', 'acked_at', 'acked_at text')
  // The managed-session lifecycle (src/sessions.ts): what was asked for,
  // what it's doing, how it ended. The REQUEST columns (provider, model,
  // effort, persona_eid, requested_task_eid) are wire-writable — creating
  // a session with them IS the spawn request; the rest is server-owned
  // (absent from comps.session, so the wire can't write it) and rides OUT
  // in the snapshot like any row.
  // Listed once, planted in place; each ddl leads with its column name.
  for (
    let ddl of [
      `origin text not null default 'external'`,
      'provider text',
      'model text',
      'effort text',
      'persona_eid text',
      'requested_task_eid text',
      'branch text',
      'base_revision text',
      'status text',
      'provider_session_id text',
      'serving_model text',
      'latest_seq integer not null default 0',
      'started_at text',
      'stop_requested_at text',
      'finished_at text',
      'exit_code integer',
      'stop_reason text',
      'final_text text',
      'usage_json text',
      'error text',
    ]
  ) addCol('session', ddl.split(' ')[0], ddl)
  // The identity chain (types.ts): instruments point at who they act for.
  addCol('client', 'actor_eid', 'actor_eid text references entity(eid)')
  // Comments are commentary, never an event log: the event column (a
  // two-day experiment in machine-minted status trails) drops on sight —
  // the journal was always the record of change.
  try {
    db.exec('alter table comment drop column event')
  } catch { /* already gone */ }
  // Inbound provenance (inbound.ts): the fleet sweep's idempotency key
  // (and the never-send mark), arrival time, and the edge's DKIM verdict
  // — see stamped.mail in types.ts.
  addCol('mail', 'message_id', 'message_id text')
  addCol('mail', 'received_at', 'received_at text')
  addCol('mail', 'verified', 'verified integer')
  addCol('session', 'actor_eid', 'actor_eid text references entity(eid)')
  // A board is a saved filter over tasks (query.ts grammar), not an edge
  // list — membership can't drift when it isn't stored.
  addCol('board', 'query', 'query text')
  addCol('project', 'retired_at', 'retired_at text')
  // A live table's check constraint is frozen at create; when the edge
  // vocabulary outgrows the baked list (the 'about' verb shipped without
  // this once — every about edge bounced off the old check), rebuild the
  // table around the current one, rows copied whole.
  let dep = db.prepare(
    `select sql from sqlite_master where type = 'table' and name = 'dependency'`,
  ).get() as { sql: string } | undefined
  if (dep && edges.some((e) => !dep.sql.includes(`'${e}'`))) {
    db.exec('begin')
    db.exec('alter table dependency rename to dependency_stale')
    db.exec(depDdl)
    db.exec('insert into dependency select * from dependency_stale')
    db.exec('drop table dependency_stale')
    db.exec('commit')
  }
  // A mail was briefly a 'send_request' (the intent idiom over-applied —
  // the artifact deserved its name). Adopt the old table's rows once;
  // `create if not exists mail` above already made the empty successor,
  // so copy across and drop the stale name.
  let sr = db.prepare(
    `select 1 from sqlite_master where type = 'table' and name = 'send_request'`,
  ).get()
  if (sr) {
    db.exec('begin')
    db.exec('insert into mail select * from send_request')
    db.exec('drop table send_request')
    db.exec('commit')
  }
  // modified_at is server-stamped on every apply() touch; rows from
  // before the column (or from direct writers) read as their creation.
  addCol('entity', 'modified_at', 'modified_at text')
  // Nums already recycled before this column existed stay unknowable —
  // monotonic from here on; old graves just don't raise the high-water.
  addCol('tombstone', 'num', 'num integer')
  db.exec(
    'update entity set modified_at = created_at where modified_at is null',
  )
  // The FTS mirror follows doc by trigger from here on. Anything older,
  // any out-of-band writer, or shadow-table damage (overlapping watcher
  // restarts have managed it) shows up here as a failed integrity check
  // or a count drift — one rebuild pass over the content table heals
  // both, and at this scale it costs milliseconds on boot.
  let count = (t: string) =>
    (db.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n
  let sound = () => {
    try {
      db.exec(
        `insert into doc_fts (doc_fts, rank) values ('integrity-check', 1)`,
      )
      return count('doc_fts') == count('doc')
    } catch {
      return false
    }
  }
  if (!sound()) db.exec(`insert into doc_fts (doc_fts) values ('rebuild')`)
  let { n } = db.prepare('select count(*) as n from task').get() as {
    n: number
  }
  if (!n) seed(db)
  return db
}

// The one live handle — the server shares it for the process lifetime.
export let db = open()

// The sync allowlist: the shared vocabulary plus the spine (which has no
// writable columns — num and created_at are server-owned, kind doesn't
// exist). Order matters — deletes run it REVERSED so dependents go first.
let cmps: Record<string, string[]> = {
  entity: [],
  ...Object.fromEntries(
    Object.entries(comps).map(([name, props]) => [name, Object.keys(props)]),
  ),
}

// The reaper's worklists, derived from the death word each reference
// declares in the vocabulary (types.ts Death says what each word means).
// No hand-kept list: a new reference picks its word where it's declared,
// and the cascade below already honors it.
let AIMED = deaths('cascade')
let DETACHED = deaths('detach')
let RELEASED = deaths('release')

// Apply a batch atomically. Unknown component names are ignored (a newer
// client speaking to an older server shouldn't wedge the socket). num and
// created_at are server-owned — never writable over the wire. Returns the
// EFFECTIVE batch: the input plus a synthesized entity-null for every
// cascade victim and the minted spine of every entity BORN here (num is
// server-owned, so no cache — the sender's included — knows it otherwise),
// so casting the return keeps every client cache honest.
//
// `t` (effects.ts Trace) is an out-param for the effect dispatcher: which
// comp rows this batch INSERTED (a create and a patch look identical as
// changes) and which existing rows it deleted. Pure bookkeeping — no
// effect ever runs in here; RULES (the claim lease, the stop_request
// gate) do, because rejecting a batch is part of what a commit means.
//
// `actor` is who's writing, when the door knows (a session id, a client
// eid) — journaled, never trusted for anything else. No auth system:
// record what's knowable, null the rest.
export let apply = (
  db: DatabaseSync,
  changes: Change[],
  t?: Trace,
  actor?: string | null,
): Change[] => {
  let dead = db.prepare('select 1 from tombstone where eid = ?')
  let extra: Change[] = []
  let touched = new Set<string>()
  let minted = new Set<string>()
  let took = (eid: string, name: string) =>
    t?.removed.set(eid, [...(t.removed.get(eid) ?? []), name])
  // A bounced claim is worth remembering: noted here mid-transaction,
  // written AFTER the rollback (an audit row can't ride the batch it
  // condemns) as a conflict entity — display strings, not references,
  // because the loser's session row may die in that same rollback.
  let bounced: { target: string; loser: string; holder: string } | null = null
  db.exec('begin')
  try {
    for (let { eid, name, comp } of changes) {
      // An edge is a TRIPLE, not a row keyed by eid: the comp names the
      // whole (parent=eid, type, child_eid) sentence, so linking is
      // insert-or-ignore, and unlinking says the same sentence with
      // gone: true — comp: null could never name WHICH edge to drop.
      // Both endpoints must be live; a bad edge (unknown type, missing
      // spine) drops alone in its savepoint like any malformed create.
      if (name == 'dependency') {
        if (!comp || dead.get(eid) || dead.get(String(comp.child_eid))) {
          continue
        }
        // Both spines checked HERE (fk enforcement is a pragma nobody
        // set): an edge may only join entities that exist.
        let spines = db.prepare(
          'select count(*) as n from entity where eid in (?, ?)',
        ).get(eid, String(comp.child_eid)) as { n: number }
        if (spines.n != 2) {
          console.warn(`sync: edge for ${eid} dropped — missing endpoint`)
          continue
        }
        db.exec('savepoint change')
        try {
          if (comp.gone) {
            db.prepare(`
              delete from dependency
              where parent_eid = ? and type = ? and child_eid = ?
            `).run(eid, String(comp.type), String(comp.child_eid))
          } else {
            db.prepare(`
              insert or ignore into dependency (parent_eid, type, child_eid)
              values (?, ?, ?)
            `).run(eid, String(comp.type), String(comp.child_eid))
          }
          db.exec('release change')
          touched.add(eid) // a moved edge is news at both ends
          touched.add(String(comp.child_eid))
        } catch (e) {
          db.exec('rollback to change')
          db.exec('release change')
          console.warn(`sync: edge for ${eid} dropped —`, e)
        }
        continue
      }
      let cols = cmps[name]
      if (!cols) continue
      touched.add(eid)
      // A deleted entity stays deleted: the tombstone voids every late or
      // replayed change for its eid — an edit racing a delete loses
      // deterministically, and nothing can resurrect the id.
      if (dead.get(eid)) continue
      // A claim is a LEASE, not a patch: taking one over another session's
      // claim fails the whole batch loudly — release, then claim. The same
      // session re-claiming is a no-op refresh. apply() runs serially on
      // the one db handle, so check-then-write here IS the atomic take.
      if (name == 'claim' && comp) {
        let cur = db.prepare(`
          select c.session_eid, s.id from claim c
          left join session s on s.eid = c.session_eid
          where c.eid = ?
        `).get(eid) as { session_eid: string; id: string | null } | undefined
        if (cur && cur.session_eid != comp.session_eid) {
          let loser = db.prepare('select id from session where eid = ?')
            .get(String(comp.session_eid)) as { id: string } | undefined
          bounced = {
            target: eid,
            loser: loser?.id ?? String(comp.session_eid),
            holder: cur.id ?? cur.session_eid,
          }
          throw new Error(
            `${eid} already claimed by ${cur.id ?? cur.session_eid}`,
          )
        }
      }
      // A stop_request is a lever, not a note: it may only be pulled on a
      // managed session that is still going — anything else is refused
      // loudly, like a bounced claim. (The stop itself is an EFFECT,
      // post-commit; this gate is the rule half.)
      if (name == 'stop_request' && comp?.target_eid) {
        let s = db.prepare('select origin, status from session where eid = ?')
          .get(String(comp.target_eid)) as
            | { origin: string; status: string | null }
            | undefined
        if (
          !s || s.origin != 'managed' ||
          !sessionActive.includes(String(s.status))
        ) {
          throw new Error(
            `stop_request refused: session is ${
              s ? s.status ?? 'external' : 'gone'
            }`,
          )
        }
      }
      if (comp == null) {
        if (name != 'entity') {
          if (
            db.prepare(`delete from ${name} where eid = ?`).run(eid).changes
          ) {
            took(eid, name)
          }
          continue
        }
        // Death spreads to entities that exist ABOUT the dead one — cards
        // viewing it, comments aimed at it, pins and cameras on a dead
        // canvas or client. The worklist walks that closure first; then
        // soft references let go (claims by a dead session, tasks of a
        // dead project); then every component row goes in reverse
        // declaration order (dependents before their referents), and only
        // then the spines — a spine can't drop while any row still aims
        // at it. Every casualty is tombstoned: nothing resurrects.
        let doomed = [eid]
        for (let i = 0; i < doomed.length; i++) {
          for (let [t, col] of AIMED) {
            let rows = db.prepare(`select eid from ${t} where ${col} = ?`)
              .all(doomed[i]) as { eid: string }[]
            for (let r of rows) {
              if (!doomed.includes(r.eid)) doomed.push(r.eid)
            }
          }
        }
        for (let d of doomed) {
          // Soft references let go — and the wire HEARS them let go, or
          // every client cache keeps a ghost (a lease whose holder died,
          // a task pointing at a gone project or assignee) until reload.
          // 'release' rows die whole (the claim vanishes, the claimed
          // entity survives) — each one synthesized into the returned
          // batch and the Trace, so removed(claim) hooks fire like any
          // deliberate release. 'detach' columns just null. A casualty's
          // own entity-null already says everything, so only SURVIVORS
          // get a change.
          for (let [t, col] of RELEASED) {
            let freed = db.prepare(`select eid from ${t} where ${col} = ?`)
              .all(d) as { eid: string }[]
            db.prepare(`delete from ${t} where ${col} = ?`).run(d)
            for (let { eid: held } of freed) {
              if (doomed.includes(held)) continue
              took(held, t)
              touched.add(held)
              extra.push({ eid: held, name: t, comp: null })
            }
          }
          for (let [t, col] of DETACHED) {
            let homed = db.prepare(`select eid from ${t} where ${col} = ?`)
              .all(d) as { eid: string }[]
            db.prepare(`update ${t} set ${col} = null where ${col} = ?`).run(d)
            for (let { eid: orphan } of homed) {
              if (doomed.includes(orphan)) continue
              touched.add(orphan)
              extra.push({ eid: orphan, name: t, comp: { [col]: null } })
            }
          }
          for (let c of Object.keys(cmps).toReversed()) {
            if (c != 'entity') {
              if (db.prepare(`delete from ${c} where eid = ?`).run(d).changes) {
                took(d, c)
              }
            }
          }
          db.prepare(
            'delete from dependency where parent_eid = ? or child_eid = ?',
          ).run(d, d)
        }
        for (let d of doomed) {
          db.prepare(
            // The num rides into the grave: a dead entity keeps its name
            // answerable, and the allocator's high-water mark survives it.
            `insert or ignore into tombstone (eid, num, deleted_at)
             values (?, (select num from entity where eid = ?), ?)`,
          ).run(d, d, new Date().toISOString())
          db.prepare('delete from entity where eid = ?').run(d)
          if (d != eid) extra.push({ eid: d, name: 'entity', comp: null })
        }
        continue
      }
      if (name == 'entity') {
        // a bare touch mints the spine; nothing to patch
        if (spine(db, eid).changes) minted.add(eid)
        continue
      }
      let sent = cols.filter((c) => c in comp)
      let vals = sent.map((c) => comp[c] as string | number | null)
      // Update first (a patch can't re-satisfy not-null columns an insert
      // would demand). An existing row implies an existing spine.
      let hit = sent.length
        ? db.prepare(
          `update ${name} set ${sent.map((c) => `"${c}" = ?`).join(', ')}
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
        if (spine(db, eid).changes) minted.add(eid)
        if (sent.length) {
          db.prepare(
            `insert into ${name} (eid${sent.map((c) => `, "${c}"`).join('')})
             values (?${', ?'.repeat(sent.length)})`,
          ).run(eid, ...vals)
          t?.created.add(`${name} ${eid}`)
        } else {
          // A bare {} touch: create with defaults if possible, else no-op.
          let made = db.prepare(
            `insert or ignore into ${name} (eid) values (?)`,
          ).run(eid).changes
          if (made) t?.created.add(`${name} ${eid}`)
        }
        db.exec('release change')
      } catch (e) {
        db.exec('rollback to change')
        db.exec('release change')
        console.warn(`sync: change for ${name} ${eid} dropped —`, e)
      }
    }
    // Every touched entity carries when it last changed — server-stamped
    // (modified_at is not in comps, so the wire can never fake it).
    // Deleted eids just miss; their rows are gone.
    let stamp = db.prepare('update entity set modified_at = ? where eid = ?')
    let now = new Date().toISOString()
    for (let eid of touched) stamp.run(now, eid)
    // Births ride the return AFTER stamping, so the spine arrives final.
    // A mint rolled back by its savepoint (or deleted later in the batch)
    // has no row — the select is the guard.
    let born = db.prepare(
      'select eid, num, created_at, modified_at from entity where eid = ?',
    )
    for (let eid of minted) {
      let row = born.get(eid) as Change['comp'] | undefined
      if (row) extra.push({ eid, name: 'entity', comp: row })
    }
    // The wire's record: one row per batch, inside the transaction — the
    // batch as APPLIED (reasons rewritten into comments, cascades and
    // births synthesized), so the record includes what the rules did, not
    // just what was asked. Recording never throws: a journal that can't
    // write must not break the write it records.
    try {
      if (changes.length || extra.length) {
        db.prepare('insert into journal (actor, batch) values (?, ?)').run(
          actor ?? null,
          JSON.stringify([...changes, ...extra]),
        )
      }
    } catch (e) {
      console.warn('journal skipped —', e)
    }
    db.exec('commit')
    return [...changes, ...extra]
  } catch (e) {
    db.exec('rollback')
    if (bounced) {
      try {
        db.exec('begin')
        let ceid = crypto.randomUUID()
        spine(db, ceid)
        db.prepare(
          `insert into conflict (eid, target_eid, loser, holder)
           values (?, ?, ?, ?)`,
        ).run(ceid, bounced.target, bounced.loser, bounced.holder)
        db.exec('commit')
      } catch (audit) {
        db.exec('rollback')
        console.warn('conflict audit failed —', audit) // never mask the claim error
      }
    }
    throw e
  }
}

// The Vocabulary doc — the schema, written INTO the graph it describes.
// Alias-keyed upsert (slug `vocabulary`), regenerated every boot with a
// body the caller rendered from the live structures (schema.ts), the
// FTS-heal pattern for documentation: stale by at most one restart. A
// no-op when the body already matches, so a quiet boot journals nothing.
// Anyone may edit the doc between boots; the next boot writes it back —
// server-minted, like every stamped column.
export let vocabularyDoc = (db: DatabaseSync, body: string): void => {
  let cur = db.prepare(`
    select a.eid, d.body from alias a
    left join doc d on d.eid = a.eid
    where a.slug = 'vocabulary'
  `).get() as { eid: string; body: string | null } | undefined
  if (cur?.body == body) return
  let eid = cur?.eid ?? crypto.randomUUID()
  apply(
    db,
    [
      { eid, name: 'doc', comp: { title: 'Vocabulary', body } },
      { eid, name: 'alias', comp: { slug: 'vocabulary' } },
    ],
    undefined,
    'server',
  )
}

// A single entity's history, newest first: the journal rows that touched
// the eid, each cut down to its changes. The batch is JSON and json_each
// does the walking — v0 reads are fine at this scale; a seek index
// arrives with the lazy-partition work (T-3683) if logs outgrow it.
export type JournalEntry = {
  ts: string
  actor: string | null
  changes: Change[]
}
export let journalOf = (
  db: DatabaseSync,
  eid: string,
  limit = 50,
): JournalEntry[] =>
  (db.prepare(`
    select distinct j.rowid, j.ts, j.actor, j.batch
    from journal j, json_each(j.batch) je
    where json_extract(je.value, '$.eid') = ?
    order by j.rowid desc limit ?
  `).all(eid, limit) as { ts: string; actor: string | null; batch: string }[])
    .map((r) => ({
      ts: r.ts,
      actor: r.actor,
      changes: (JSON.parse(r.batch) as Change[]).filter((c) => c.eid == eid),
    }))

// The same record cut by WHO instead of what: every batch an actor
// wrote, whole (no per-eid filtering — a lapse ledger wants the batch's
// full sentence). Newest first, like journalOf.
export let journalBy = (
  db: DatabaseSync,
  actor: string,
  limit = 500,
): JournalEntry[] =>
  (db.prepare(`
    select ts, actor, batch from journal
    where actor = ? order by rowid desc limit ?
  `).all(actor, limit) as { ts: string; actor: string | null; batch: string }[])
    .map((r) => ({
      ts: r.ts,
      actor: r.actor,
      changes: JSON.parse(r.batch) as Change[],
    }))

// A recall touch — the server-minted aggregate behind ranked retrieval
// (query.ts hot()). Bumps count and last_at; first_at never moves. It
// deliberately does NOT stamp modified_at: reading is not editing, and
// recency-in-search must not feed back on itself. `confirm` also stamps
// memory.last_confirmed_at — an explicit re-confirmation is the
// strongest touch there is. Skips eids with no live spine (tombstoned
// or unknown). Returns the fresh rows as cast-able changes so every
// cache hears the new warmth.
export let touch = (
  db: DatabaseSync,
  eids: string[],
  confirm = false,
): Change[] => {
  let now = new Date().toISOString()
  let out: Change[] = []
  for (let eid of eids) {
    if (!db.prepare('select 1 from entity where eid = ?').get(eid)) continue
    db.prepare(`
      insert into recall (eid, first_at, last_at) values (?, ?, ?)
      on conflict (eid) do update
      set count = count + 1, last_at = excluded.last_at
    `).run(eid, now, now)
    out.push({
      eid,
      name: 'recall',
      comp: db.prepare('select * from recall where eid = ?')
        .get(eid) as Change['comp'],
    })
    if (
      confirm &&
      db.prepare('update memory set last_confirmed_at = ? where eid = ?')
        .run(now, eid).changes
    ) {
      out.push({
        eid,
        name: 'memory',
        comp: db.prepare('select * from memory where eid = ?')
          .get(eid) as Change['comp'],
      })
    }
  }
  return out
}

// Full-text search over every doc — tasks, boards, projects, comments all
// carry one. User words are quoted into FTS terms (AND semantics) so raw
// operator syntax can't error, and EVERY term prefix-matches — search is
// typed live, so the words are half-typed more often than not ('card fon'
// must already find the font mockups). Rank blends bm25 (title hits well
// over body hits) with recency — what you touched today is what you're
// looking for — matching the house recall bias. Snippets mark matches
// with \x01…\x02 so renderers can highlight without trusting HTML. A comment hit points
// open_eid at its target — you open the conversation, not the aside.
// A search line mixes FTS terms with dot-param filters (query.ts —
// 'runner .status=done .modified_at=today'): the TEXT preds drive FTS,
// the rest screen each hit against its components, and a line of ONLY
// filters is a listing, newest touched first. A malformed filter throws;
// the doors show the message.
// Resolve a sugar value server-side: an alias slug, or a prefix-num /
// bare num against the spine — the db's half of client.ts find().
export let findEid = (db: DatabaseSync, id: string): string | undefined => {
  let num = id.match(/^[A-Za-z]+-(\d+)$/)?.[1] ?? id.match(/^(\d+)$/)?.[1]
  let hit = num
    ? db.prepare('select eid from entity where num = ?').get(Number(num))
    : db.prepare('select eid from alias where slug = ?').get(id)
  return (hit as { eid: string } | undefined)?.eid
}

export let search = (db: DatabaseSync, q: string, limit = 20): Hit[] => {
  let preds = parseQuery(q)
  let filters = preds.filter((p) => p.op != TEXT)
  let match = preds.filter((p) => p.op == TEXT)
    .map((p) => {
      let word = p.value.replace(/\*+$/, '').replaceAll('"', '')
      return word && `"${word}"*`
    })
    .filter(Boolean).join(' ')
  if (!match && !filters.length) return []
  // Filters screen AFTER the rank, so cast a wider net before the cap.
  let rows = match
    ? db.prepare(`
      select d.eid, d.title,
        snippet(doc_fts, 1, char(1), char(2), '…', 10) as snip,
        e.num
      from doc_fts
      join doc d on d.rowid = doc_fts.rowid
      join entity e on e.eid = d.eid
      where doc_fts match ?
      order by bm25(doc_fts, 8.0, 1.0)
        - 2.0 / (1 + julianday('now') - julianday(e.modified_at)) limit ?
    `).all(match, filters.length ? limit * 10 : limit) as (Omit<
      Hit,
      'kind' | 'open_eid' | 'retired'
    >)[]
    : db.prepare(`
      select d.eid, d.title, '' as snip, e.num
      from doc d
      join entity e on e.eid = d.eid
      order by e.modified_at desc limit ?
    `).all(limit * 10) as (Omit<Hit, 'kind' | 'open_eid' | 'retired'>)[]
  if (filters.length) {
    // Sugar values in the filters ('.assignee=jeff') resolve against the
    // db — alias slug or human num, same forms find() speaks.
    filters = resolveRefs(filters, (id) => findEid(db, id))
    // Each hit's components, only the ones the filters actually read —
    // matchQuery sees the same shape a live cache row has. A path pred
    // reads its TARGET through the same fetcher (compsOf doubles as the
    // ent argument), so `.assignee.title~=j` walks one row further.
    let names = [
      ...new Set(filters.flatMap((p) => p.at ? [p.comp, p.at.comp] : [p.comp])),
    ]
    let get = new Map(
      names.map((c) => [c, db.prepare(`select * from ${c} where eid = ?`)]),
    )
    let compsOf = (eid: string) => {
      let comps: Record<string, Record<string, unknown> | undefined> = {}
      for (let [c, s] of get) {
        comps[c] = s.get(eid) as Record<string, unknown> | undefined
      }
      return comps
    }
    rows = rows.filter((r) => matchQuery(compsOf(r.eid), filters, compsOf))
      .slice(0, limit)
  }
  let is = kindOrder.map((k) =>
    [k, db.prepare(`select 1 from ${k} where eid = ?`)] as const
  )
  let aim = db.prepare('select target_eid from comment where eid = ?')
  // Retirement sinks a hit, never hides it: a hit that IS a retired
  // project, or a task filed under one, keeps its rank order among the
  // sunk — they all queue behind the last live hit, flagged for the
  // renderers to mark.
  let sank = db.prepare(`
    select 1 from project p
    left join task t on t.eid = ?1
    where p.retired_at is not null
      and p.eid in (?1, t.project_eid)
  `)
  let hits = rows.map((r) => {
    let kind = is.find(([, s]) => s.get(r.eid))?.[0] ?? 'entity'
    let target = (aim.get(r.eid) as { target_eid: string } | undefined)
      ?.target_eid
    return {
      ...r,
      kind,
      open_eid: target ?? r.eid,
      ...(sank.get(r.eid) ? { retired: true } : {}),
    }
  })
  return [...hits.filter((h) => !h.retired), ...hits.filter((h) => h.retired)]
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
