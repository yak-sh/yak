// Component inventories stay valid across schema mutation and rollback.
import { equal, test } from '@yaks/testing'
import { open } from './db.ts'
import { componentTables } from './physical.ts'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { driver } from './native.ts'

let d = open(':memory:')
let make = (name: string) =>
  d.query({
    t: 'create table',
    name,
    cols: [{ name: 'entity', type: 'integer', pk: true }],
  })
make('one')

test('component inventory follows schema changes and rollback, with caller-local exclusions', () => {
  using _cleanup = { [Symbol.dispose]: d.close }
  equal(componentTables(d), ['one'])
  equal(componentTables(d, ['one']), [])
  equal(componentTables(d), ['one'])
  d.query({ t: 'begin' })
  make('two')
  equal(componentTables(d), ['one', 'two'])
  d.query({ t: 'rollback' })
  equal(componentTables(d), ['one'])
  d.query({ t: 'drop', kind: 'table', name: 'one' })
  equal(componentTables(d), [])
})

let shapes = new Database(':memory:')
shapes.exec(`
  create table good (entity integer primary key);
  create temp table good (entity text primary key);
  create temp table temporary_only (entity integer primary key);
  attach ':memory:' as extra;
  create table extra.attached (entity integer primary key);
  create table text_key (entity text primary key);
  create table ordinary (entity integer);
  create table cf_component (entity integer primary key);
  create table _Cf_KV (entity integer primary key);
  create table __cf_METADATA (entity integer primary key);
  create table entity (entity integer primary key);
  create virtual table search using fts5(body);
`)
let shaped = driver(shapes)
test('component inventory uses main table keys and excludes provider, temporary and virtual tables', () => {
  using _cleanup = { [Symbol.dispose]: () => shapes.close() }
  equal(componentTables(shaped), ['cf_component', 'good'])
  equal(componentTables(shaped, ['good']), ['cf_component'])
})
