// An older file's providers, models and tools, moved onto the ids their names
// derive (D-37943). The harness once wrote them under ids of its own —
// `provider:openai`, `model:<name>`, `tool:<name>`, a hash per provider and
// model — and a model carried the one provider that served it. Now `name` is
// each one's identity (the vocabulary's `identity` keyword), a model is the
// model whoever serves it, and a provider's offering of a model is a `serves`
// edge carrying the provider's own name for the model.
//
// Two passes, because an identity is also a unique index and `install()`
// cannot create one over two rows sharing a name:
//
//   {@link renamed}, before `install()`: every provider, model and tool takes
//   the id its name derives. Where two entities share a name they are one
//   entity now: the older keeps its integer id, takes the component rows it
//   lacked, and every reference to the other (a component's reference column,
//   a foreign key, the journal) points at it before the other is deleted. An
//   edge touching one of them takes the id its ends now derive.
//
//   {@link named}, after it: each `model.provider` the first pass read out
//   becomes a `serves` edge, and so does each model a fallback transport's
//   `provider.serves` names; the old columns go; the moved entities are
//   classified again.
//
// Integer ids are what rows point at, so a re-identified entity keeps every
// reference to it; only the eid the integer is called by moves. Both passes
// are idempotent, and the marker the second writes skips both next time.

import { type Eid, identityEid } from '@yaks/graph'
import { edgeEid, names } from '@yaks/edge'
import {
  componentTables,
  type Driver,
  fold,
  pointers,
  reclassify,
  type Store,
} from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'

let q = (name: string) => '"' + name.replaceAll('"', '""') + '"'

/** The marker {@link named} writes when it commits. */
export let NAMED = 'names-v1'

let NAMES = ['provider', 'model', 'tool']

// Where the first pass keeps the offerings for the second.
let OFFERS = 'harness_offer'

let tables = (sql: Driver): string[] =>
  sql.query("select name from sqlite_schema where type = 'table'", [])
    .map((r) => String(r.name))

let columns = (sql: Driver, table: string): string[] =>
  sql.query(`pragma table_info(${q(table)})`, []).map((c) => String(c.name))

let done = (sql: Driver): boolean =>
  tables(sql).includes('harness_upgrade') &&
  sql.query('select 1 from harness_upgrade where name = ?', [NAMED]).length > 0

let eidOf = (sql: Driver, id: number): Eid =>
  String(sql.query('select eid from entity where id = ?', [id])[0].eid)

let idOf = (sql: Driver, eid: Eid): number | undefined =>
  sql.query('select id from entity where eid = ?', [eid])[0]?.id as
    | number
    | undefined

/** What {@link renamed} did: entities called by a new id, and entities folded
 * into another of the same name. */
export type Renamed = { moved: number; merged: number }

/** The first pass, before `install()`: one entity per name, called by the id
 * the name derives. */
export let renamed = (sql: Driver, vocab: Vocab): Renamed => {
  let out: Renamed = { moved: 0, merged: 0 }
  let present = tables(sql)
  if (done(sql) || !NAMES.some((t) => present.includes(t))) return out
  let owned = componentTables(sql)
  let refs = pointers(sql, vocab)
  let into = fold(sql, refs)
  let merge = (gone: number, keep: number) => {
    into(gone, keep)
    out.merged++
  }
  sql.exec('begin immediate')
  try {
    // The offerings, held aside until the `serves` table stands. A merge
    // points them at the entity that stays, like every other reference.
    if (columns(sql, 'model').includes('provider')) {
      sql.exec(
        `create table if not exists ${OFFERS}` +
          ' (provider integer, model integer, name text)',
      )
      sql.exec(
        `insert into ${OFFERS} select provider, entity, name from model` +
          ' where provider is not null and name is not null',
      )
      // A fallback transport runs every model of the provider it names.
      if (columns(sql, 'provider').includes('serves')) {
        sql.exec(
          `insert into ${OFFERS} select p.entity, o.model, o.name` +
            ` from provider p join ${OFFERS} o on o.provider = p.serves`,
        )
      }
      refs.push([OFFERS, 'provider'], [OFFERS, 'model'])
    }
    let ends: number[] = []
    for (let comp of NAMES.filter((t) => present.includes(t))) {
      let groups = new Map<Eid, number[]>()
      for (
        let r of sql.query(
          `select entity, name from ${q(comp)} where name is not null` +
            ' order by entity',
          [],
        )
      ) {
        let eid = identityEid(comp, [String(r.name)])
        groups.set(eid, [...groups.get(eid) ?? [], Number(r.entity)])
      }
      for (let [eid, ids] of groups) {
        let held = idOf(sql, eid)
        let keep = held ?? ids[0]
        for (let id of ids) if (id != keep) merge(id, keep)
        if (held == null) {
          sql.query('update entity set eid = ? where id = ?', [eid, keep])
          out.moved++
        }
        ends.push(keep)
      }
    }
    // The links touching them: an edge's id is derived from its ends' ids.
    let tags = names(vocab)
    let links = present.includes('edge')
      ? sql.query(
        'select entity, "from", "to" from edge where "from" in' +
          ' (select value from json_each(?1)) or "to" in' +
          ' (select value from json_each(?1))',
        [JSON.stringify(ends)],
      )
      : []
    for (let r of links) {
      let id = Number(r.entity)
      let tag = owned.find((t) =>
        tags[t] &&
        sql.query(`select 1 from ${q(t)} where entity = ?`, [id]).length
      )
      if (!tag) continue
      let eid = edgeEid(
        eidOf(sql, Number(r.from)),
        tag,
        eidOf(sql, Number(r.to)),
      )
      let twin = idOf(sql, eid)
      if (twin == id) continue
      if (twin != null) merge(id, twin)
      else {
        sql.query('update entity set eid = ? where id = ?', [eid, id])
        out.moved++
      }
    }
    sql.exec('commit')
  } catch (error) {
    sql.exec('rollback')
    throw error
  }
  return out
}

/** The second pass, after `install()`: the offerings the first pass held
 * aside, as `serves` edges; the old columns gone; the marker. Answers how many
 * edges it wrote, or `null` when the marker says it has run. */
export let named = (sql: Driver, store: Store): number | null => {
  if (done(sql)) return null
  sql.exec('create table if not exists harness_upgrade (name text primary key)')
  return store.tx((tx) => {
    let said = tables(sql).includes(OFFERS)
      ? sql.query(`select provider, model, name from ${OFFERS}`, [])
      : []
    let edges = new Map(said.map((o) => {
      let from = eidOf(sql, Number(o.provider))
      let to = eidOf(sql, Number(o.model))
      return [edgeEid(from, 'serves', to), { from, to, name: String(o.name) }]
    }))
    tx.patch(
      [...edges].map(([eid, o]) => ({
        entity: { eid },
        edge: { from: o.from, to: o.to },
        serves: { name: o.name },
      })),
    )
    sql.exec(`drop table if exists ${OFFERS}`)
    for (let [t, c] of [['model', 'provider'], ['provider', 'serves']]) {
      if (!columns(sql, t).includes(c)) continue
      sql.exec(`drop index if exists ${q(`${t}_${c}`)}`)
      sql.exec(`alter table ${q(t)} drop column ${q(c)}`)
    }
    // Where the file keeps archetypes (a server's vocabulary does, the
    // harness's does not), every entity the passes touched is classified by
    // the rows it holds now: the providers, models and tools, and the links
    // touching them.
    if (tables(sql).includes('archetype')) {
      let held = NAMES.map((t) => `select entity from ${q(t)}`).join(' union ')
      reclassify(
        sql,
        sql.query(
          `with n(id) as (${held}) select eid from entity where id in n or` +
            ' id in (select entity from edge where "from" in n or "to" in n)',
          [],
        ).map((r) => String(r.eid)),
      )
    }
    sql.query('insert into harness_upgrade values (?)', [NAMED])
    return edges.size
  }) as number
}
