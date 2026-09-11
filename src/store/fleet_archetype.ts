// Fleet SQL policy still writes physical facets outside the composed graph
// (recall, lifecycle, blob_text and embeddings). Capture presence transitions,
// not values, in the same transaction. The queue retains the first pre-image;
// nulling the pointer makes an interrupted/foreign writer fall back safely.
// Flush uses @yaks/archetype's immutable sets and hash-free transition cache,
// never a per-entity component census. Queue rows are storage, not facets.
import { type Archetype, Archetypes, tablesOf } from '@yaks/archetype'
import { componentTables, type Driver } from '@yaks/sqlite'
import type { Change } from '../types.ts'
import type { Sql, Statement } from './sql.ts'

let quote = (s: string) => `"${s.replaceAll('"', '""')}"`
let text = (s: string) => `'${s.replaceAll("'", "''")}'`
let caches = new WeakMap<Sql, {
  sets: Archetypes
  text: Map<string, Archetype>
  statements: Map<string, Statement>
}>()

export function watchArchetypes(db: Sql, driver: Driver): void {
  db.exec(`create table if not exists archetype_pending (
    owner integer primary key, prior integer
  );
  create table if not exists archetype_delta (
    owner integer, name text, present integer, primary key(owner, name)
  );
  create trigger if not exists archetype_birth after insert on entity begin
    insert or ignore into archetype_pending(owner, prior) values (new.id, null);
  end;`)
  for (let name of componentTables(driver)) {
    for (
      let [event, row, present] of [
        ['insert', 'new', 1],
        ['delete', 'old', 0],
      ] as const
    ) {
      db.exec(
        `create trigger if not exists ${quote(`archetype_${name}_${event}`)}
        after ${event} on ${quote(name)} begin
        insert or ignore into archetype_pending(owner, prior)
          select id, archetype from entity where id = ${row}.entity;
        insert into archetype_delta(owner, name, present)
          values (${row}.entity, ${text(name)}, ${present})
          on conflict(owner, name) do update set present = excluded.present;
        update entity set archetype = null where id = ${row}.entity;
      end;`,
      )
    }
  }
}

/** Called inside the writer's transaction; returns descriptor and spine echoes. */
export function flushArchetypes(db: Sql): Change[] {
  let held = caches.get(db)
  if (!held) {
    held = { sets: new Archetypes(), text: new Map(), statements: new Map() }
    caches.set(db, held)
  }
  let { sets: cache, text, statements } = held
  let prep = (sql: string) => {
    let stmt = statements.get(sql)
    if (!stmt) statements.set(sql, stmt = db.prepare(sql))
    return stmt
  }
  let decode = (value: string) => {
    let set = text.get(value)
    if (!set) text.set(value, set = cache.intern(tablesOf(value)))
    return set
  }
  let pending = prep(`select p.owner, p.prior, e.eid, a.tables
    from archetype_pending p join entity e on e.id = p.owner
    left join archetype a on a.entity = p.prior`).all<{
    owner: number
    prior: number | null
    eid: string
    tables: string | null
  }>()
  if (!pending.length) {
    db.exec('delete from archetype_delta; delete from archetype_pending')
    return []
  }
  let owners = new Map(pending.map((p) => [p.owner, {
    ...p,
    set: p.tables == null ? cache.intern([]) : decode(p.tables),
  }]))
  for (
    let d of prep('select owner, name, present from archetype_delta').all<{
      owner: number
      name: string
      present: number
    }>()
  ) {
    let owner = owners.get(d.owner)
    if (owner) owner.set = cache.move(owner.set, d.name, !!d.present)
  }
  let out: Change[] = []
  let meta = cache.intern(['archetype'])
  let ids = new Map<string, number>()
  let made = new Set<number>()
  let mint = (eid: string): number => {
    let id = ids.get(eid)
    if (id != null) return id
    let found = prep(`select e.id, a.tables from entity e
      left join archetype a on a.entity = e.id where e.eid = ?`).get<{
      id: number
      tables: string | null
    }>(eid)
    if (found?.tables != null) {
      if (decode(found.tables).eid != eid) {
        throw new Error(`Invalid archetype identity: ${eid}`)
      }
      ids.set(eid, found.id)
      return found.id
    }
    if (found && owners.get(found.id)?.set.tables.length !== 0) {
      throw new Error(`Archetype identity is occupied: ${eid}`)
    }
    if (!found) prep('insert into entity(eid) values (?)').run(eid)
    id = found?.id ?? Number(db.lastInsertRowId)
    ids.set(eid, id)
    made.add(id)
    let tables = JSON.stringify(cache.get(eid)!.tables)
    prep('insert into archetype(entity, tables) values (?, ?)').run(id, tables)
    let target = eid == meta.eid ? id : mint(meta.eid)
    prep('update entity set archetype = ? where id = ?').run(target, id)
    out.push(
      { eid, name: 'entity', comp: { eid, num: null, archetype: meta.eid } },
      { eid, name: 'archetype', comp: { tables } },
    )
    return id
  }
  let targets = [...owners.values()].map((p) => [p, mint(p.set.eid)] as const)
  for (let [p, id] of targets) {
    if (made.has(p.owner)) continue
    prep('update entity set archetype = ? where id = ?').run(id, p.owner)
    // The physical tombstone is classified, but its wire event remains a
    // deletion. A later metadata patch would resurrect it during delta replay.
    if (id != p.prior && !p.set.tables.includes('tombstone')) {
      out.push({ eid: p.eid, name: 'entity', comp: { archetype: p.set.eid } })
    }
  }
  db.exec('delete from archetype_delta; delete from archetype_pending')
  return out
}
