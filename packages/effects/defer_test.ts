// A temporarily unavailable dependency keeps its original durable intent,
// across worker replacements and without spending failure retries.
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, match, test } from '@yaks/testing'
import { effects } from './registry.ts'
import { pooledBlog as vocab } from './testing.ts'

for (let singleOwner of [false, true]) {
  let fixture = await (async () => {
    let storage = ram(vocab), now = 0, ready = false, tries = 0, workers = 0
    let writer = effects(vocab, { owes: 'declared' })
    let g = graph({ storage, vocab, plugins: [writer] })
    await g.apply([{ entity: { eid: 'post' }, post: {} }])
    let seen: string[] = []
    let worker = () => {
      let owner = `worker-${++workers}`
      g.apply([{ entity: { eid: owner }, subscriber: {} }])
      let fx = effects(vocab, {
        owner,
        singleOwner,
        defer: true,
        now: () => now,
        write: (bs) => g.apply(bs, { trusted: true }),
        report: () => {},
      })
      fx.handle({
        post_note: async (_e, _tx, _write, attempt) => {
          tries++
          if (!ready) return await attempt!.defer!(20)
          if (tries == 3) throw Error('ordinary failure')
          seen.push('done')
        },
      })
      return fx
    }
    let pending = async () => (await g.read('.effect.handler=post_note'))[0]
    let first = worker()
    let original = (await pending()).entity.eid
    await first.work(g, undefined, 1)
    let deferred = await pending()
    let next = worker()
    await next.work(g, undefined, 1)
    let before = tries
    now = 20
    await next.work(g, undefined, 1)
    let again = await pending()
    ready = true
    now = 40
    await next.work(g, undefined, 1)
    let failed = await pending()
    now = 1040
    await worker().work(g, undefined, 1)
    return {
      original,
      deferred,
      before,
      again,
      failed,
      final: await pending(),
      seen,
    }
  })()
  test(`deferral preserves work and retry allowance across replacements (${singleOwner})`, () => {
    let { original, deferred, before, again, failed, final, seen } = fixture
    equal(deferred.entity.eid, original)
    equal(again.entity.eid, original)
    for (let [row, at] of [[deferred, 20], [again, 40]] as const) {
      match(row, {
        effect: {
          state: 'pending',
          attempts: 0,
          next: new Date(at).toISOString(),
        },
      })
      if (!singleOwner) match(row, { effect: { lease_owner: null } })
    }
    equal(before, 1)
    match(failed, { effect: { state: 'pending', attempts: 1 } })
    equal(final, undefined)
    equal(seen, ['done'])
  })
}
