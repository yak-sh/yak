// A host can owe durable start-up runs at deployment, independently of a
// registry waking or joining. The same recorded runs retain pool retry behavior.
import {
  type Access,
  type Bundle,
  dead,
  detached,
  guard,
  type Storage,
} from '@yaks/graph'
import { after } from '@yaks/fp'
import { matcher } from '@yaks/match'
import { memory } from '../graph/testing.ts'
import { equal, match, test, throws } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { effectDoc } from './pool.ts'
import { effects, type Opts } from './registry.ts'

let vocab = loadVocab([pick(effectDoc, ['effect']), {
  $defs: {
    store: { component: true },
    boot: { effect: true, start: true, tries: 2 },
    unhandled: { effect: true, start: true },
    disabled: { effect: true, start: true },
  },
}])
let proc = (opts: Opts, storage: Storage) => {
  let seen: string[] = []
  let fx = effects(vocab, {
    owner: 'store',
    defer: true,
    report: () => {},
    disabled: ['disabled'],
    ...opts,
  })
  let outside = detached(storage)
  // Pool scheduling needs committed reads and guarded persistence; the
  // README exercises this same API through the graph's complete write path.
  let g: Access = {
    vocab,
    outside,
    get: outside.get,
    read: outside.read,
    rows: storage.rows,
    apply: (bundles) =>
      storage.tx((tx) =>
        after(
          guard(bundles, tx, vocab),
          (ready) =>
            after(
              tx.remove(ready.filter(dead).map((b) => b.entity)),
              () => after(tx.patch(ready.filter((b) => !dead(b))), () => ready),
            ),
        )
      ),
  }
  fx.handle({
    boot: (e) => void seen.push(`${e.kind}:${e.entity.eid}`),
    disabled: () => void seen.push('disabled'),
  })
  storage.tx((tx) => tx.patch([{ entity: { eid: 'store' }, store: {} }]))
  return { g, fx, seen, storage }
}
let rows = async (g: Awaited<ReturnType<typeof proc>>['g']) =>
  (await g.read('.effect')).map((b) => b.effect!)
let work = (p: Awaited<ReturnType<typeof proc>>) => p.fx.work(p.g, undefined, 1)

// Use the graph's Map fixture for persistence and its in-memory query
// evaluator for pool selection, without SQL compilation on each small read.
let store = (): Storage => {
  let base = memory()
  let eids = new Set<string>()
  let read: Storage['read'] = (q, opts) =>
    matcher(q, vocab, opts)(base.get([...eids]) as Bundle[])
  return {
    ...base,
    read,
    rows: (q, opts) =>
      (read(q, opts) as Bundle[]).map((b) => ({ eid: b.entity.eid })),
    tx: (body) =>
      base.tx((tx) =>
        body({
          ...tx,
          patch: (bs) => {
            for (let b of bs) eids.add(b.entity.eid)
            return tx.patch(bs)
          },
        })
      ),
  }
}
let check = (name: string, body: (storage: Storage) => Promise<void>) =>
  test(name, () => body(store()))

for (let singleOwner of [false, true]) {
  check(
    `manual startup persists only handled runs when the host asks (${singleOwner})`,
    async (storage) => {
      let p = proc({ singleOwner, startup: 'manual' }, storage)
      await p.fx.work(p.g, undefined, 0)
      equal(await rows(p.g), [])
      await p.fx.startup(p.g)
      equal(p.seen, [])
      match(await rows(p.g), [{
        handler: 'boot',
        target: 'store',
        kind: 'started',
        state: 'pending',
        attempts: 0,
      }])
      // A later deployment on this same registry owes a fresh run.
      await p.fx.startup(p.g)
      equal((await rows(p.g)).length, 2)
      equal(p.seen, [])
    },
  )
}

for (let singleOwner of [false, true]) {
  check(
    `startup defaults distinguish shared joining from single-owner wakes (${singleOwner})`,
    async (storage) => {
      let p = proc({ singleOwner }, storage)
      await p.fx.work(p.g, undefined, 0)
      await p.fx.work(p.g, undefined, 0)
      equal((await rows(p.g)).length, singleOwner ? 0 : 1)
      let next = proc({ singleOwner }, p.storage)
      await next.fx.work(next.g, undefined, 0)
      equal((await rows(next.g)).length, singleOwner ? 0 : 2)
    },
  )
}

// A deployment already owed the run; a new registry is its next wake.
let deployed = proc({ singleOwner: true }, store())
await deployed.fx.startup(deployed.g)
test('deployment startup survives a wake and records failure for retry', async () => {
  let next = proc({ singleOwner: true, now: () => 0 }, deployed.storage)
  next.fx.handle({
    boot: (e, _tx, _write, attempt) => {
      equal(e.kind, 'started')
      equal(attempt!.last(), false)
      throw Error('try again')
    },
  })
  await work(next)
  match(await rows(next.g), [{
    state: 'pending',
    attempts: 1,
    next: new Date(1000).toISOString(),
  }])
})

// A failed first attempt is the input to recovery after another wake.
let interrupted = proc({ singleOwner: true, now: () => 0 }, store())
await interrupted.fx.startup(interrupted.g)
interrupted.fx.handle({
  boot: () => {
    throw Error('try again')
  },
})
await work(interrupted)
test('a later wake retries recorded startup with the remaining attempt allowance', async () => {
  let next = proc({ singleOwner: true, now: () => 1000 }, interrupted.storage)
  next.fx.handle({
    boot: (e, _tx, _write, attempt) => {
      equal(e.kind, 'started')
      equal(attempt!.last(), true)
      next.seen.push(e.entity.eid)
    },
  })
  await work(next)
  equal(next.seen, ['store'])
  equal(await rows(next.g), [])
})

check(
  'a failed startup write rejects and the host can owe it again',
  async (storage) => {
    let p = proc({ singleOwner: true }, storage)
    let apply = p.g.apply
    p.g.apply = () => Promise.reject(Error('store unavailable'))
    await throws(() => p.fx.startup(p.g), 'store unavailable')
    p.g.apply = apply
    equal(await rows(p.g), [])
    await p.fx.startup(p.g)
    await work(p)
    equal(p.seen, ['started:store'])
  },
)
