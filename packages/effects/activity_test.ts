import { equal, ok, test } from '@yaks/testing'
import { channel, type Event } from '@yaks/trace'
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
