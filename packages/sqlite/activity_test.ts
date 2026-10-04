// SQL activity through the native driver and graph, including asynchronous
// hooks and tracker work outside named phases.
import { equal, ok, test, throws } from '@yaks/testing'
import {
  channel,
  context,
  during,
  peek,
  record,
  type Recorded,
  scope,
} from '@yaks/trace'
import {
  col,
  from,
  insert,
  render,
  select,
  table,
  unionAll,
  val,
} from '@yaks/sql'
import { type Bundle, graph, type Tx } from '@yaks/graph'
import { open } from './db.ts'
import { storage } from './mod.ts'
import { shop } from './testing.ts'
import { isPromise } from '@yaks/fp'
import { stub } from '@std/testing/mock'

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  if (isPromise(out)) throw new Error('embedded apply went async')
  return out
}

test('SQL spans count returned and affected rows without values or SQL text', () => {
  let db = open(':memory:')
  try {
    db.query({
      t: 'create table',
      name: 'sample',
      cols: [{ name: 'value', unique: true }],
    })
    let captured = record(db, () => {
      let c = ok(peek(db))
      return during(c.begin({ kind: 'bench', name: 'statements' }), () => {
        db.query(
          insert('sample', { value: 'private-value' }, { value: 'another' }),
        )
        db.query(
          render({
            t: 'update',
            table: 'sample',
            set: { value: val('edited-private') },
            where: { t: 'op', op: '=', parts: [col('value'), val('another')] },
          }),
        )
        db.query(
          select({
            from: from(
              unionAll(
                select({ from: table('sample') }),
                select({ from: table('sample') }),
              ),
            ),
          }),
        )
        db.query({
          t: 'delete',
          from: 'sample',
          where: {
            t: 'op',
            op: '=',
            parts: [col('value'), val('edited-private')],
          },
        })
        db.query({ t: 'pragma', name: 'table_info', arg: 'sample' })
        db.query({ t: 'savepoint', name: 'private-savepoint' })
        db.query({ t: 'release', name: 'private-savepoint' })
        throws(() => db.query(insert('sample', { value: 'private-value' })))
      })
    })
    let sql = captured.spans.filter((s) => s.kind == 'sql')
    equal(sql.map((s) => [s.name, s.counts?.rows, s.outcome]), [
      ['sample insert', 2, 'ok'],
      ['sample update', 1, 'ok'],
      ['sample select', 4, 'ok'],
      ['sample delete', 1, 'ok'],
      ['table_info pragma', 1, 'ok'],
      ['savepoint', 0, 'ok'],
      ['release', 0, 'ok'],
      ['sample insert', undefined, 'error'],
    ])
    ok(sql.every((s) => s.parent == captured.spans[0].id))
    ok(!JSON.stringify(captured.spans).includes('private'))
    equal(context(), undefined)
  } finally {
    db.close()
  }
})

test('an idle SQL driver creates no spans or clocks, including after disconnect', () => {
  let db = open(':memory:')
  try {
    let c = channel(db)
    let stop = c.subscribe(() => {})
    stop()
    let clock = stub(performance, 'now', () => {
      throw new Error('idle clock')
    })
    let begin = stub(c, 'begin', () => {
      throw new Error('idle span')
    })
    try {
      db.query(select({ cols: [val('private')] }))
      equal(peek(db), undefined)
      equal(c.history(), [])
    } finally {
      clock.restore()
      begin.restore()
    }
  } finally {
    db.close()
  }
})

test('SQL parents survive interleaved async hooks and tracker flushes', async () => {
  let db = open(':memory:')
  let gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  let store = storage(db, shop)
  store.install()
  let stop = channel(db).subscribe(() => {})
  let g = graph({
    storage: store,
    vocab: shop,
    plugins: [{
      name: 'shop',
      hooks: {
        prepare: async (b, tx) => {
          let i = Number((b[0].doc as { title: string }).title)
          await gates[i].promise
          await tx.read('.product')
          return b
        },
      },
      track: (tx) => ({
        tx,
        flush: (b) => {
          tx.read('.product')
          return b
        },
      }),
    }],
  })
  try {
    let first = record(
      g,
      () => g.apply([{ entity: { eid: 'first' }, doc: { title: '0' } }]),
    )
    let second = record(
      g,
      () => g.apply([{ entity: { eid: 'second' }, doc: { title: '1' } }]),
    )
    gates[1].resolve()
    let other = await second
    gates[0].resolve()
    let own = await first
    let ids = new Set(own.spans.map((s) => s.id))
    ok(other.spans.every((s) => !ids.has(s.id)))
    for (let captured of [own, other]) {
      let parents = new Map(captured.spans.map((s) => [s.id, s]))
      let sql = captured.spans.filter((s) => s.kind == 'sql')
      ok(sql.length > 0)
      ok(sql.every((s) => parents.has(s.parent!)))
      ok(sql.some((s) => parents.get(s.parent!)?.plugin == 'shop'))
      ok(sql.some((s) => parents.get(s.parent!)?.name == 'transaction'))
      ok(sql.some((s) => parents.get(s.parent!)?.name == 'mutate'))
      ok(sql.some((s) => s.name == 'entity select'))
    }
  } finally {
    stop()
    db.close()
  }
})

test('disconnected SQL context cannot record into a later subscriber', () => {
  let db = open(':memory:')
  try {
    let target = {}
    let c = channel(target)
    let stop = c.subscribe(() => {})
    let held = during(
      c.begin({ kind: 'apply', name: 'apply' }),
      () => context(),
    )
    stop()
    stop = c.subscribe(() => {})
    scope(held, () => db.query(select({ cols: [val(1)] })))
    equal(c.history().filter((s) => s.kind == 'sql'), [])
    stop()
  } finally {
    db.close()
  }
})

test('a retained transaction keeps its owner during a reentrant apply', () => {
  let db = open(':memory:')
  let store = storage(db, shop)
  store.install()
  let retained: Tx
  let other: Recorded<unknown> | undefined
  let g = graph({
    storage: store,
    vocab: shop,
    plugins: [{
      name: 'shop',
      hooks: {
        prepare: (b, tx) => {
          if (b[0].entity.eid == 'first') {
            retained = tx
            other = record(
              g,
              () =>
                sync(g.apply([{
                  entity: { eid: 'second' },
                  doc: { title: 'second' },
                }])),
            )
          } else retained.read('.product')
          return b
        },
      },
    }],
  })
  try {
    let own = record(
      g,
      () =>
        sync(g.apply([{ entity: { eid: 'first' }, doc: { title: 'first' } }])),
    )
    let hook = ok(
      own.spans.find((s) => s.name == 'prepare' && s.plugin == 'shop'),
    )
    ok(own.spans.some((s) => s.kind == 'sql' && s.parent == hook.id))
    let nestedHook = ok(
      other?.spans.find((s) => s.name == 'prepare' && s.plugin == 'shop'),
    )
    ok(!other?.spans.some((s) => s.kind == 'sql' && s.parent == nestedHook.id))
  } finally {
    db.close()
  }
})

test('SQL remains under read spans after asynchronous query rewriting', async () => {
  let db = open(':memory:')
  let store = storage(db, shop)
  store.install()
  let g = graph({
    storage: store,
    vocab: shop,
    plugins: [{
      name: 'shop',
      ask: async (ctx, q) => {
        await Promise.resolve()
        await ctx.tx.get(['sample'])
        return q
      },
    }],
  })
  try {
    g.apply([{ entity: { eid: 'sample' }, product: { price: 10 } }])
    for (
      let run of [
        () => g.read('.product'),
        () => g.rows('.product'),
        () => g.get(['sample'], ['product']),
      ]
    ) {
      let captured = await record(g, run)
      let sql = captured.spans.filter((s) => s.kind == 'sql')
      ok(sql.length > 0)
      ok(sql.every((s) => s.parent == captured.spans[0].id))
    }
  } finally {
    db.close()
  }
})
