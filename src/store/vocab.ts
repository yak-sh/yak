// An app's OWN components (T-32502): the `vocab.json` at the root of an app's
// files, read by app_deploy and planted in that app's store. The platform's
// vocabulary is generated from the Rust contract (src/vocab/manifests) and is
// the same in every store; this is the one vocabulary a person's agent writes
// by hand, so it is the smallest thing that can say a table:
//
//   { "recipe": { "title": "text", "serves": "number" } }
//
// One component per key, one typed column per entry — the `cols` of a manifest
// entry and nothing around it. A store's own words are ADDITIVE forever: a
// later deploy may add a column, never drop or retype one, because the rows
// are already there and this file is the only record of them. A word the
// platform already owns is refused — `doc` means `doc` in every store.
import type { SchemaOp } from '../db.ts'
import { comps, type PropType, stamped } from '../types.ts'

// A store's own components: the same shape as `comps`, restricted to the
// scalar types a hand-written manifest can spell.
export type Vocab = Record<string, Record<string, PropType>>

// The types an app may declare, and the SQLite affinity each stores as —
// ddl.ts's sqlType restricted to what a hand-written manifest can spell, and
// restated here so this module stays out of the DDL generator's import graph
// (client.ts reads the teaching line below, and the browser reads client.ts).
// References, enums and bodies are the platform's to grow: each carries
// machinery — a foreign key, a closed set, a content-addressed blob — that a
// store cannot plant from one word.
export let TYPES: Record<string, string> = {
  text: 'text',
  number: 'real',
  bool: 'integer',
  time: 'text',
  url: 'text',
}

export let EXAMPLE = '{"recipe": {"title": "text", "serves": "number"}}'

export let GUIDE = 'https://yaks.app/guide.md'

// What a store says when it is asked for a word nobody declared — the same
// sentence at the write door and the query door, because it is the same
// missing act.
export let TEACH = ' — a component of your own is declared in vocab.json ' +
  `and planted by app_deploy: ${EXAMPLE} · ${GUIDE}`

// The dot-param sketch an APP's store answers with, in place of the fleet
// CLI's (query.ts SKETCH): the words every store shares, one of its own, and
// where a new one comes from. db.ts hands it to query.ts when a store plants
// its first vocabulary — no example from another graph reaches an app.
export let FILTERS =
  'filters are dot-params: .doc.title~=word, .task.status=open, ' +
  `.recipe.serves=4, …${TEACH}`

let NAME = /^[a-z][a-z0-9_]{0,39}$/

let quote = (name: string) => `"${name.replaceAll('"', '""')}"`

// One column's DDL. No foreign key: an app declares scalars, so nothing here
// points at another entity.
let column = (col: string, type: PropType) =>
  `${quote(col)} ${TYPES[String(type)]}`

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// Every word the platform already says, in one sorted list: the writable
// vocabulary, the server-stamped half, and the spine. No store may redeclare
// one — `doc` means `doc` everywhere — so this is also what the guide prints
// under vocab.json (guide_test.ts holds the two in step).
export let RESERVED: string[] = [
  ...new Set([...Object.keys(comps), ...Object.keys(stamped), 'entity']),
].sort()

// The manifest as written, checked. Every refusal names the file and the
// spelling that works, because the agent reading it has no other source.
export let parseVocab = (source: unknown): Vocab => {
  if (typeof source == 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      throw new Error(`vocab.json is not JSON — ${EXAMPLE}`)
    }
  }
  if (!object(source)) throw new Error(`vocab.json is an object — ${EXAMPLE}`)
  // The platform's words, all of them, before anything is planted: a manifest
  // refused one name at a time is probed one deploy at a time, and every
  // probe that got through left a component behind for good (C-32624 item 1).
  let taken = Object.keys(source).filter((name) => RESERVED.includes(name))
  if (taken.length) {
    throw new Error(
      `vocab.json: ${taken.join(', ')} ${
        taken.length == 1 ? 'is a word' : 'are words'
      } the platform already says — pick another name; the whole list is in ` +
        `the guide under "Components of your own" (${GUIDE})`,
    )
  }
  let out: Vocab = {}
  for (let [name, cols] of Object.entries(source)) {
    if (!NAME.test(name)) {
      throw new Error(
        `vocab.json: ${JSON.stringify(name)} is not a component name ` +
          '(a-z, 0-9, _)',
      )
    }
    if (!object(cols)) {
      throw new Error(
        `vocab.json: ${name} is an object of columns — ${EXAMPLE}`,
      )
    }
    let mine: Record<string, PropType> = {}
    for (let [col, type] of Object.entries(cols)) {
      if (!NAME.test(col) || col == 'entity' || col == 'eid') {
        throw new Error(
          `vocab.json: ${name}.${JSON.stringify(col)} is not a column name`,
        )
      }
      if (typeof type != 'string' || !(type in TYPES)) {
        throw new Error(
          `vocab.json: ${name}.${col} is ${JSON.stringify(type)} — one of ${
            Object.keys(TYPES).join(', ')
          }`,
        )
      }
      mine[col] = type as PropType
    }
    out[name] = mine
  }
  return out
}

// The manifest a store keeps after a deploy: columns only ever ARRIVE. A
// column the new manifest stopped naming stays declared — its rows are still
// there — and one whose type changed is refused, because the values already
// stored were written under the old word.
//
// A whole COMPONENT the manifest stopped naming is the one thing that may
// leave, and only when it holds nothing: a name tried once and abandoned is a
// probe's leftover, not data, and it used to be declared forever (C-32624
// item 1). `rows` counts what a component holds — the store's question, since
// only it has the tables — and a caller that cannot count says so by leaving
// it out: nothing is dropped unless something says it is empty.
export let grow = (
  was: Vocab,
  next: Vocab,
  rows: (name: string) => number = () => 1,
): { vocab: Vocab; dropped: string[] } => {
  let dropped = Object.keys(was).filter((name) =>
    !(name in next) && !rows(name)
  )
  let out: Vocab = { ...was }
  for (let name of dropped) delete out[name]
  for (let [name, cols] of Object.entries(next)) {
    let had = was[name] ?? {}
    for (let [col, type] of Object.entries(cols)) {
      if (had[col] && had[col] != type) {
        throw new Error(
          `vocab.json: ${name}.${col} is already ${had[col]} — ` +
            'a column keeps the type its rows were written under',
        )
      }
    }
    out[name] = { ...had, ...cols }
  }
  return { vocab: out, dropped }
}

// How a store counts one component's rows, in this module because this module
// owns how a component's name is spelled as a table.
export let countSql = (name: string) =>
  `select count(*) as n from ${quote(name)}`

// And what an empty component's departure costs: the table, nothing else. A
// dropped word's rows are none by construction — that is what let it go.
export let dropOps = (names: string[]): SchemaOp[] =>
  names.map((name) => ({
    kind: 'exec',
    sql: `drop table if exists ${quote(name)}`,
  } as SchemaOp))

// The DDL that makes the manifest true, additive both ways: the table when the
// store has never seen the word, one guarded `add column` per column so a
// manifest that grew plants only what is new. db.ts `graft()` runs the guards.
export let vocabOps = (vocab: Vocab): SchemaOp[] =>
  Object.entries(vocab).flatMap(([name, cols]) => [
    {
      kind: 'exec',
      sql: `create table if not exists ${quote(name)} (\n` +
        [
          '    entity integer primary key references entity(id)',
          ...Object.entries(cols).map(([col, type]) =>
            `    ${column(col, type)}`
          ),
        ].join(',\n') + '\n  )',
    } as SchemaOp,
    ...Object.entries(cols).map(([col, type]): SchemaOp => ({
      kind: 'addColumn',
      table: name,
      col,
      sql: `alter table ${quote(name)} add column ${column(col, type)}`,
    })),
  ])
