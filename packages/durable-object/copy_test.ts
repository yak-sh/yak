import { equal, test } from '@yaks/testing'
import { col, eq, op, select, table, val } from '@yaks/sql'
import { arrived, copied, ending, page, plan, raised } from './copy.ts'
import { driver } from './sql.ts'
import { durable } from './testing.ts'

let ddl = (d: ReturnType<typeof driver>, sql: string) =>
  d.query({ t: 'catalogued', sql })

let source = () => {
  let d = driver(durable())
  ddl(d, 'create table parent (id integer primary key autoincrement, v)')
  ddl(d, 'create table child (of integer references parent(id), blob)')
  ddl(d, 'create table text_src (entity integer primary key, title text)')
  ddl(d, 'create view text_view as select entity, title from text_src')
  ddl(
    d,
    "create virtual table text_fts using fts5(title, content='text_view', content_rowid='entity')",
  )
  ddl(d, 'create index child_of on child(of)')
  ddl(
    d,
    'create trigger parent_counted after insert on parent begin insert into child values (new.id, null); end',
  )
  // A counter past the rows that remain.
  d.query({
    t: 'insert',
    into: 'parent',
    cols: ['id', 'v'],
    rows: [[val(7), val('kept')]],
  })
  d.query({ t: 'delete', from: 'child' })
  d.query({ t: 'delete', from: 'parent' })
  d.query({
    t: 'insert',
    into: 'parent',
    cols: ['id', 'v'],
    rows: [[val(3), val('kept')]],
  })
  d.query({
    t: 'insert',
    into: 'child',
    cols: ['of', 'blob'],
    rows: [[val(3), val(new Uint8Array([0, 255, 9]))]],
  })
  d.query({
    t: 'insert',
    into: 'text_src',
    cols: ['entity', 'title'],
    rows: [[val(1), val('findable words')]],
  })
  return d
}

let copyOf = (from: ReturnType<typeof driver>) => {
  let to = driver(durable()), p = plan(from)
  copied(to, p)
  let here: Record<string, unknown> = {}
  for (let t of p.tables) {
    let held = raised(), after = 0
    while (true) {
      let next = page(from, t, after, held, 2)
      held = next.held
      if (next.last == null) break
      arrived(to, t, next.rows)
      after = next.last
    }
    here[t.name] = held
  }
  return { to, here, there: ending(to, p), p }
}

test('a copy holds the same rows, rowids and blobs, firing nothing', () => {
  let from = source()
  let { to, here, there } = copyOf(from)
  equal(there, here)
  let all = (d: typeof to, name: string, cols: string[]) =>
    d.query(select({ cols: cols.map((c) => col(c)), from: table(name) }))
  for (
    let [name, ...cols] of [
      ['parent', 'id', 'v'],
      ['child', 'of', 'blob'],
      ['text_src', 'entity', 'title'],
    ]
  ) equal(all(to, name, cols), all(from, name, cols))
})

test('a copy leaves its triggers, counters and full-text index working', () => {
  let { to } = copyOf(source())
  // The counter stands past the rows it once gave out.
  to.query({ t: 'insert', into: 'parent', cols: ['v'], rows: [[val('next')]] })
  let [{ id }] = to.query(select({
    cols: [col('id')],
    from: table('parent'),
    where: eq(col('v'), val('next')),
  }))
  equal(id, 8)
  // The trigger came across, and fired for that row only.
  equal(
    to.query(select({ cols: [col('of')], from: table('child') })).map((r) =>
      r.of
    ),
    [3, 3, 8],
  )
  equal(
    to.query(select({
      cols: [col('rowid')],
      from: table('text_fts'),
      where: op('match', col('text_fts'), val('findable')),
    })).length,
    1,
  )
})
