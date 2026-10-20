// A prototype sanity run for ./history.ts on a graph in memory. Not for landing.
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from './db.ts'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { raw } from '../sql/ast.ts'
import { branch, reads, tip, versioned, within } from './history.ts'

let d = open(':memory:')
let vocab = loadVocab(docDoc)
let store = storage(d, vocab)
store.install()
let run = (sql: string) => d.query(raw(sql))
run('drop table "doc"')
run(
  'create table "doc" ("entity" integer not null references entity(id), "title" text,' +
    ' "body" text, "$branch" integer not null default 0, "$from" integer,' +
    ' "$to" integer not null default 0, primary key ("entity", "$branch", "$to")) without rowid',
)
run(
  'create table "tx" ("id" integer primary key, "at" text not null, "by" integer, "via" integer, "branch" integer not null default 0)',
)
run(
  'create table "branch" ("id" integer primary key, "parent" integer not null, "fork" integer not null, "at" text not null)',
)
run('create table "history_tables" ("name" text primary key)')
run(`insert into "history_tables" values ('doc')`)
reads(versioned(d).tables)
let g = graph({ storage: store, vocab })
let rows = () =>
  run(
    'select "entity", "title", "$branch" b, "$from" f, "$to" t from "doc" order by 1, 3, 4',
  )
await g.apply([{ entity: { eid: 'p1' }, doc: { title: 'one', body: 'b' } }])
let t1 = tip(d)
await g.apply([{ entity: { eid: 'p1' }, doc: { title: 'two' } }])
await g.apply([{ entity: { eid: 'p2' }, doc: { title: 'other' } }])
console.log('rows', rows())
console.log('now', (await g.get(['p1']))[0].doc, await g.read('.doc'))
console.log('at t1', await within({ at: t1 }, () => g.get(['p1'])))
console.log(
  'read title=two',
  (await g.read('.doc.title=two')).length,
  'title=one',
  (await g.read('.doc.title=one')).length,
)
let b = branch(d)
await within(
  b,
  () => g.apply([{ entity: { eid: 'p1' }, doc: { title: 'on branch' } }]),
)
console.log(
  'branch get',
  (await within(b, () => g.get(['p1'])))[0].doc,
  'main get',
  (await g.get(['p1']))[0].doc,
)
console.log(
  'branch read',
  (await within(b, () => g.read('.doc'))).map((x) => x.doc),
)
await g.apply([{ entity: { eid: 'p2' }, $delete: true }])
console.log('after delete', rows(), await g.read('.doc'))
await g.apply([{ entity: { eid: 'p1' }, doc: null }])
console.log(
  'after drop',
  rows(),
  await g.read('.doc'),
  (await g.get(['p1']))[0],
)
console.log('tx', run('select count(*) n from "tx"'))
{
  let { render } = await import('../sql/render.ts')
  let q0 = d.query
  d.query = (s) => {
    console.log('SQL', render(s as never).sql.slice(0, 300))
    console.log('AST', JSON.stringify(s).slice(0, 1500))
    return q0(s)
  }
  console.log(
    'branch read again',
    (await within(b, () => g.read('.doc'))).map((x) => x.doc),
  )
  d.query = q0
}
