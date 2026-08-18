// The last hand-kept twin of the vocabulary, closed: a component's SQLite
// `create table` + `create index` DDL, DERIVED from `comps`/`stamped`/`indexes`
// the same way db.ts already derives its sync allowlist (`cmps`) and readable
// set. One PropType → one column affinity; one `{eid}` reference → one
// `references entity(eid)` (except death 'keep', which carries no FK so a
// tombstoned spine can't veto the delete — the mail.target rule, types.ts); one
// `indexesFor` entry → one index. A new component or `{eid}` field lands its
// table and indexes with no second edit here.
//
// This generates the STRAIGHTFORWARD per-component tables — every column
// nullable, no default. A table that needs a default, a NOT NULL, a CHECK, a
// non-entity key, an integer-affine number, or a column ORDER a migration
// depends on stays hand-written in db.ts (`derived` there names the exact
// split); the generator only ever touches the clean majority. A PropType can
// express none of those constraints, so the derivable set is exactly what the
// vocabulary CAN describe — which is exactly the shape any plugin comps fragment
// can take. Column names are always quoted, so a keyword column ("by", "order")
// needs no special-casing and the emitted identifier is uniform.
import { comps, type Idx, type PropType, stamped } from './types.ts'
import { indexesFor } from './index.ts'
import { refOf } from './props.ts'

// PropType → the SQL column affinity it stores as. Text is the catch-all: an
// enum, a time, a url, a body and a well-backed text live as text; numbers and
// bools diverge; and an `{eid}` reference now stores the target's INTERNAL
// integer id (D-18866) — the eid stays the wire identity, resolved at the
// apply()/snapshot() boundary — so a reference is integer-affine.
/// sqlType('number') -> 'real'
/// sqlType('priority') -> 'real'
/// sqlType('bool') -> 'integer'
/// sqlType('body') -> 'text'
/// sqlType({ enum: ['a', 'b'] }) -> 'text'
/// sqlType({ eid: 'project', death: 'detach' }) -> 'integer'
/// sqlType({ text: 'domains' }) -> 'text'
export let sqlType = (t: PropType): string =>
  t == 'number' || t == 'priority' ? 'real'
    : t == 'bool' ? 'integer'
    : typeof t == 'object' && 'eid' in t ? 'integer'
    : 'text'

let quote = (name: string) => `"${name.replaceAll('"', '""')}"`

// One column's DDL: `"<name>" <affinity>[ references entity(id)]`. A reference
// stores the target's internal integer id and carries the FK to entity(id)
// UNLESS its death word is 'keep' — a kept reference outlives its target's
// tombstone (types.ts, mail.target), and a kept FK would keep the reference
// pointing at a spine row that survives deletion anyway, so it stays FK-free the
// way it always did.
export let columnDdl = (comp: string, prop: string, t: PropType): string => {
  let ref = refOf(comp, prop)
  let fk = ref && (typeof t != 'object' || !('eid' in t) || t.death != 'keep')
    ? ' references entity(id)'
    : ''
  return `${quote(prop)} ${sqlType(t)}${fk}`
}

// Every column a component declares — wire-writable (`comps`) then server-owned
// (`stamped`), in declaration order — so a stamped column (mail.from,
// claim.claimed_at) still gets its table column.
export let derivedCols = (comp: string): { prop: string; ddl: string }[] =>
  [
    ...Object.entries(comps[comp] ?? {}),
    ...Object.entries(stamped[comp] ?? {}),
  ].map(([prop, t]) => ({ prop, ddl: columnDdl(comp, prop, t) }))

// One component's `create table`: the entity-keyed spine reference plus its
// columns. The owner key is `entity` — the target's INTERNAL integer id
// (D-18866), one row per entity — referencing entity(id); its eid is projected
// back at the read boundary (db.ts select()). `if not exists` keeps it
// idempotent — a fresh db gets the table, a live db that already has it is
// untouched (db.ts's addDerivedCols fills any column a later vocabulary edit
// adds; the legacy eid→id migration reshapes an eid-keyed table in place).
export let tableDdl = (comp: string): string =>
  `create table if not exists ${quote(comp)} (\n` +
  [
    `    entity integer primary key references entity(id)`,
    ...derivedCols(comp).map(({ ddl }) => `    ${ddl}`),
  ].join(',\n') +
  `\n  )`

// One index's DDL, named `<comp>_<cols>` — the spelling that matches the
// hand-DDL names it stands in for (entry_session_seq, …). Exported so open()
// can realize a single index by name (guarding creates with hasIdx) without
// re-parsing the name back out of the whole-comp string set.
export let indexDdlOne = (comp: string, i: Idx): string =>
  `create ${i.unique ? 'unique ' : ''}index if not exists ` +
  `${comp}_${i.cols.join('_')} on ${quote(comp)} (${
    i.cols.map(quote).join(', ')
  })${i.where ? ` where ${i.where}` : ''}`

// One component's indexes, from the ONE declared source (`indexesFor`: the
// composite/unique declarations plus one auto index per `{eid}` reference).
export let indexDdl = (comp: string): string[] =>
  indexesFor(comp).map((i) => indexDdlOne(comp, i))
