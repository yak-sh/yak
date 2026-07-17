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
  type Dep,
  type Hit,
  kindOrder,
  type Snapshot,
} from './types.ts'

// The db lives outside the repo (this is open source): a home-dir dotpath by
// default, overridable with DB_PATH.
let file = Deno.env.get('DB_PATH') ??
  `${Deno.env.get('HOME')}/.tasks/tasks.db`

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
    eid text primary key references entity(eid)
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
// No kind: an entity is what its components make it.
let spine = (db: DatabaseSync, eid: string) => {
  let now = new Date().toISOString()
  return db.prepare(`
    insert or ignore into entity (eid, num, created_at, modified_at)
    values (?, (select coalesce(max(num), 0) + 1 from entity), ?, ?)
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
  addCol('task', 'domain', 'domain text')
  addCol('session', 'cwd', 'cwd text')
  addCol('session', 'acked_at', 'acked_at text')
  // The managed-session lifecycle (src/sessions.ts): what we spawned, what
  // it's doing, how it ended. Server-owned — none of it is in comps.session,
  // so the wire can't write it; it rides OUT in the snapshot like any row.
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
  // A board is a saved filter over tasks (query.ts grammar), not an edge
  // list — membership can't drift when it isn't stored.
  addCol('board', 'query', 'query text')
  // modified_at is server-stamped on every apply() touch; rows from
  // before the column (or from direct writers) read as their creation.
  addCol('entity', 'modified_at', 'modified_at text')
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
let cmps: Record<string, string[]> = { entity: [], ...comps }

// Components whose ROW EXISTENCE hangs on another entity: when that
// entity dies, the row's whole entity dies with it. Soft references
// (a claim's session, a task's project) are NOT here — they let go
// instead of dying.
let AIMED: [string, string][] = [
  ['card', 'target_eid'],
  ['comment', 'target_eid'],
  ['pin', 'canvas_eid'],
  ['camera', 'client_eid'],
  ['camera', 'canvas_eid'],
  ['fold', 'client_eid'],
  ['fold', 'board_eid'],
]

// Apply a batch atomically. Unknown component names are ignored (a newer
// client speaking to an older server shouldn't wedge the socket). num and
// created_at are server-owned — never writable over the wire. Returns the
// EFFECTIVE batch: the input plus a synthesized entity-null for every
// cascade victim and the minted spine of every entity BORN here (num is
// server-owned, so no cache — the sender's included — knows it otherwise),
// so casting the return keeps every client cache honest.
export let apply = (db: DatabaseSync, changes: Change[]): Change[] => {
  let dead = db.prepare('select 1 from tombstone where eid = ?')
  let extra: Change[] = []
  let touched = new Set<string>()
  let minted = new Set<string>()
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
      if (comp == null) {
        if (name != 'entity') {
          db.prepare(`delete from ${name} where eid = ?`).run(eid)
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
          db.prepare('delete from claim where session_eid = ?').run(d)
          db.prepare('update task set project_eid = null where project_eid = ?')
            .run(d)
          for (let t of Object.keys(cmps).toReversed()) {
            if (t != 'entity') {
              db.prepare(`delete from ${t} where eid = ?`).run(d)
            }
          }
          db.prepare(
            'delete from dependency where parent_eid = ? or child_eid = ?',
          ).run(d, d)
        }
        for (let d of doomed) {
          db.prepare(
            'insert or ignore into tombstone (eid, deleted_at) values (?, ?)',
          ).run(d, new Date().toISOString())
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
        if (spine(db, eid).changes) minted.add(eid)
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

// Full-text search over every doc — tasks, boards, projects, comments all
// carry one. User words are quoted into FTS terms (AND semantics; a
// trailing * keeps prefix search) so raw operator syntax can't error.
// Title hits outweigh body hits; snippets mark matches with \x01…\x02 so
// renderers can highlight without trusting HTML. A comment hit points
// open_eid at its target — you open the conversation, not the aside.
export let search = (db: DatabaseSync, q: string, limit = 20): Hit[] => {
  let match = q.trim().split(/\s+/)
    .map((t) => {
      let prefix = t.endsWith('*')
      let word = (prefix ? t.slice(0, -1) : t).replaceAll('"', '')
      return word && `"${word}"${prefix ? '*' : ''}`
    })
    .filter(Boolean).join(' ')
  if (!match) return []
  let rows = db.prepare(`
    select d.eid, d.title,
      snippet(doc_fts, 1, char(1), char(2), '…', 10) as snip,
      e.num
    from doc_fts
    join doc d on d.rowid = doc_fts.rowid
    join entity e on e.eid = d.eid
    where doc_fts match ?
    order by bm25(doc_fts, 4.0, 1.0) limit ?
  `).all(match, limit) as (Omit<Hit, 'kind' | 'open_eid'>)[]
  let is = kindOrder.map((k) =>
    [k, db.prepare(`select 1 from ${k} where eid = ?`)] as const
  )
  let aim = db.prepare('select target_eid from comment where eid = ?')
  return rows.map((r) => {
    let kind = is.find(([, s]) => s.get(r.eid))?.[0] ?? 'entity'
    let target = (aim.get(r.eid) as { target_eid: string } | undefined)
      ?.target_eid
    return { ...r, kind, open_eid: target ?? r.eid }
  })
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
