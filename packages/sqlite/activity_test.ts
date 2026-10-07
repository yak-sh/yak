// SQL activity through the native driver and graph, including asynchronous
// hooks and tracker work outside named phases.
import { equal, ok, test, throws } from '@yaks/testing'
import {
  channel,
  type Context,
  context,
  during,
  installContext,
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
import { AsyncLocalStorage } from 'node:async_hooks'

let sync = (out: Bundle[] | Promise<Bundle[]>): Bundle[] => {
  if (isPromise(out)) throw new Error('embedded apply went async')
  return out
}

test('SQL spans count returned and affected rows and say what they ran without its values', () => {
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
        db.query(render(unionAll(
          select({ from: table('sample') }),
          select({ from: table('sample') }),
        )))
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
        db.query({ t: 'savepoint', name: 'unit' })
        db.query({ t: 'release', name: 'unit' })
        throws(() => db.query(insert('sample', { value: 'private-value' })))
      })
    })
    let sql = captured.spans.filter((s) => s.kind == 'sql')
    equal(sql.map((s) => [s.name, s.counts?.rows, s.outcome]), [
      ['sample insert', 2, 'ok'],
      ['sample update', 1, 'ok'],
      ['sample select', 4, 'ok'],
      ['sample select', 4, 'ok'],
      ['sample delete', 1, 'ok'],
      ['table_info pragma', 1, 'ok'],
      ['savepoint', 0, 'ok'],
      ['release', 0, 'ok'],
      ['sample insert', undefined, 'error'],
    ])
    equal(captured.spans[0].counts, {
      statements: 9,
      rowsRead: 9,
      rowsWritten: 4,
    })
    equal(sql[0].counts, {
      rows: 2,
      statements: 1,
      rowsRead: 0,
      rowsWritten: 2,
    })
    equal(sql[8].counts, {
      statements: 1,
      rowsRead: 0,
      rowsWritten: 0,
    })
    ok(sql.every((s) => s.parent == captured.spans[0].id))
    equal(sql.map((s) => s.sql), [
      'insert into "sample" ("value") values (?), (?)',
      'update "sample" set "value" = ? where "value" = ?',
      'select * from (select * from "sample" union all select * from "sample")',
      'select * from "sample" union all select * from "sample"',
      'delete from "sample" where "value" = ?',
      'pragma table_info("sample")',
      'savepoint "unit"',
      'release "unit"',
      'insert into "sample" ("value") values (?)',
    ])
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

test('a span begun after an await stays above the retained transaction SQL', async () => {
  let db = open(':memory:')
  let store = storage(db, shop)
  store.install()
  let g = graph({
    storage: store,
    vocab: shop,
    plugins: [{
      name: 'shop',
      hooks: {
        prepare: async (b, tx, _err, at) => {
          await Promise.resolve()
          let c = ok(peek(g))
          return during(
            c.begin({ kind: 'rule', name: 'lookup', parent: at?.parent }),
            () => {
              tx.read('.product')
              return b
            },
          )
        },
      },
    }],
  })
  try {
    let captured = await record(
      g,
      () => g.apply([{ entity: { eid: 'sample' }, doc: { title: 'sample' } }]),
    )
    let rule = ok(captured.spans.find((s) => s.kind == 'rule'))
    ok(captured.spans.some((s) => s.kind == 'sql' && s.parent == rule.id))
  } finally {
    db.close()
  }
})

test('SQLite charges async request trees once without crossing interleaved requests', async () => {
  let local = new AsyncLocalStorage<Context | undefined>()
  let restore = installContext({
    get: () => local.getStore(),
    run: (at, work) => local.run(at, work),
  })
  let db = open(':memory:')
  let store = storage(db, shop)
  store.install()
  let g = graph({ storage: store, vocab: shop })
  let gate = Promise.withResolvers<void>()
  let entered = Promise.withResolvers<void>()
  let run = (name: string, wait?: Promise<void>) =>
    record(g, () => {
      let c = ok(peek(g))
      return during(c.begin({ kind: 'request', name }), async () => {
        if (wait) {
          entered.resolve()
          await wait
        }
        await g.apply([{ entity: { eid: name }, product: { price: 10 } }])
        await Promise.resolve()
        await g.read('.product')
      })
    })
  try {
    let pending = run('first', gate.promise)
    await entered.promise
    let second = await run('second')
    gate.resolve()
    let first = await pending
    let ids = new Set(first.spans.map((s) => s.id))
    ok(second.spans.every((s) => !ids.has(s.id)))
    for (let captured of [first, second]) {
      let sql = captured.spans.filter((s) => s.kind == 'sql')
      ok(sql.length > 0)
      let totals = { statements: 0, rowsRead: 0, rowsWritten: 0 }
      for (let span of sql) {
        for (let key of Object.keys(totals) as (keyof typeof totals)[]) {
          totals[key] += span.counts?.[key] ?? 0
        }
      }
      equal(captured.spans[0].counts, totals)
      equal(totals.statements, sql.length)
      ok(totals.rowsRead > 0)
      ok(totals.rowsWritten > 0)
      ok(captured.spans.some((s) => s.kind == 'apply'))
      ok(captured.spans.some((s) => s.kind == 'query'))
      // Every SQL statement belongs to a path ending at this request, not a
      // neighbouring request or an independent metric read.
      let spans = new Map(captured.spans.map((s) => [s.id, s]))
      for (let span of sql) {
        while (span.parent) span = ok(spans.get(span.parent))
        equal(span.id, captured.spans[0].id)
      }
    }
  } finally {
    gate.resolve()
    db.close()
    restore()
  }
})
