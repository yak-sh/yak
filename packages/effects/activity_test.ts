import { equal, ok, test } from '@yaks/testing'
import {
  channel,
  type Context as TraceContext,
  type Event,
  installContext,
} from '@yaks/trace'
import { AsyncLocalStorage } from 'node:async_hooks'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { effects } from './registry.ts'
import { blogGraph, owingBlog, pooledBlog } from './testing.ts'

for (let pooled of [false, true]) {
  test(`effect run and one-argument write preserve local causal parent (${pooled})`, async () => {
    let vocab = pooled ? pooledBlog : owingBlog
    let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
    let g = blogGraph([fx], vocab)
    let seen: Event[] = []
    let off = channel(g).subscribe((e) => seen.push(e))
    fx.handle({
      post_note: async (_e, _tx, write) => {
        await write([{
          entity: { eid: 'note-private' },
          comment: { text: 'private' },
        }])
      },
      post_gone: () => {},
      post_swept: () => {},
    })
    let signal = new AbortController()
    signal.abort()
    if (pooled) await fx.work(g, signal.signal)
    await g.apply([{
      entity: { eid: 'post-private' },
      post: { title: 'private' },
    }])
    await fx.idle()
    let start = ok(
      seen.find((e) =>
        e.kind == 'effect' && e.name == 'post_note' &&
        e.stage == 'start'
      ),
    )
    ok(seen.some((e) =>
      e.kind == 'effect' && e.stage == 'instant' &&
      e.counts?.owed == 1
    ))
    ok(seen.some((e) => e.kind == 'apply' && e.parent == start.id))
    ok(seen.some((e) => e.id == start.id && e.stage == 'end'))
    ok(!JSON.stringify(seen).includes('private'))
    off()
    await fx.stop()
  })
}

test('effect failure is isolated and observed without error payload', async () => {
  let reported = 0
  let fx = effects(owingBlog, {
    report: () => {
      reported++
    },
  })
  let g = blogGraph([fx], owingBlog)
  let c = channel(g)
  let off = c.subscribe(() => {})
  fx.handle({
    post_note: () => {
      throw new Error('private failure')
    },
  })
  await g.apply([{ entity: { eid: 'post' }, post: { title: 'title' } }])
  equal(reported, 1)
  ok(
    c.history().some((e) =>
      e.kind == 'effect' && e.name == 'post_note' &&
      e.stage == 'end' && e.outcome == 'error'
    ),
  )
  ok(!JSON.stringify(c.history()).includes('private failure'))
  off()
})

for (let pooled of [false, true]) {
  test(`effect reads and SQL stay beneath their run across awaits (${pooled})`, async () => {
    let local = new AsyncLocalStorage<TraceContext | undefined>()
    let restore = installContext({
      get: () => local.getStore(),
      run: (ctx, work) => local.run(ctx, work),
    })
    let vocab = pooled ? pooledBlog : owingBlog
    let sql = open(':memory:')
    let db = storage(sql, vocab)
    db.install()
    let fx = effects(vocab, {
      singleOwner: true,
      write: (b) => g.apply(b, { trusted: true }),
    })
    let g = graph({ storage: db, vocab, plugins: [fx] })
    let seen: Event[] = []
    let off = channel(g).subscribe((e) => seen.push(e), { history: false })
    fx.handle({
      post_note: async (_e, tx, write) => {
        await Promise.resolve()
        await tx.read('.post')
        await g.read('.post')
        await Promise.resolve()
        await write([{
          entity: { eid: 'note' },
          comment: { text: 'A note' },
        }])
      },
    })
    try {
      await g.apply([{
        entity: { eid: 'post' },
        post: { title: 'A post' },
      }])
      if (pooled) await fx.work(g)
      await fx.idle()
      let run = ok(
        seen.find((e) =>
          e.kind == 'effect' && e.name == 'post_note' && e.stage == 'end'
        ),
      )
      let finished = new Map(
        seen.filter((e) => e.stage == 'end').map((e) => [e.id, e]),
      )
      let below = (e: Event): boolean => {
        for (
          let parent = e.parent;
          parent;
          parent = finished.get(parent)?.parent
        ) {
          if (parent == run.id) return true
        }
        return false
      }
      let reads = [...finished.values()].filter((e) =>
        (e.kind == 'query' || e.kind == 'get') && below(e)
      )
      ok(reads.length > 0)
      let statements = [...finished.values()].filter((e) =>
        e.kind == 'sql' && below(e)
      )
      ok(statements.length > 0)
      equal(run.counts?.statements, statements.length)
      equal(
        run.counts?.rowsRead,
        statements.reduce((n, e) => n + (e.counts?.rowsRead ?? 0), 0),
      )
      equal(
        run.counts?.rowsWritten,
        statements.reduce((n, e) => n + (e.counts?.rowsWritten ?? 0), 0),
      )
      ok(run.counts!.rowsRead > 0)
      ok(run.counts!.rowsWritten > 0)
      if (pooled) equal(run.counts?.runs, 1)
      equal(run.outcome, 'ok')
      if (pooled) equal(await g.read('.effect'), [])
    } finally {
      off()
      await fx.stop()
      sql.close()
      restore()
    }
  })
}
