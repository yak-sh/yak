// Expiration removes a declaration's component through the ordinary graph
// door, with bounded batches, concurrency guards and one daily duty.
import { equal, ok, test } from '@yaks/testing'
import { type Access, type Bundle, type Comp, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { DAY, EXPIRE, expire, expireDaily } from './expire.ts'
import { effectDoc } from './pool.ts'
import { leaseEid } from './lease.ts'
import { effects } from './registry.ts'

let vocab = loadVocab([{
  ...effectDoc,
  $defs: {
    ...effectDoc.$defs,
    effect: {
      ...effectDoc.$defs!.effect,
      expire: '.effect.state=done,failed .effect.at<="7d ago"',
    },
  },
}, {
  $defs: {
    created: {
      component: true,
      properties: { at: { type: 'string', stamped: true } },
    },
    updated: {
      component: true,
      properties: { at: { type: 'string', stamped: true } },
    },
    item: { component: true },
    cache: {
      component: true,
      expire: '.cache.old=true | .item',
      properties: { old: { type: 'boolean' } },
    },
  },
}])
let now = Date.parse('2026-10-03T12:00:00Z')
let old = new Date(now - 8 * DAY).toISOString()
let recent = new Date(now - DAY).toISOString()
let run = (eid: string, state = 'done', at = old): Bundle => ({
  entity: { eid },
  effect: { state, at },
})
let make = () => {
  let g = graph({ vocab, storage: ram(vocab) })
  g.apply(
    ['worker', 'rival', 'one', 'two'].map((eid) => ({
      entity: { eid },
      item: {},
    })),
  )
  return g
}

test('expire batches matching rows; preserves live runs, other components and unrelated OR matches', async () => {
  let g = make()
  await g.apply([
    run('done'),
    run('failed', 'failed'),
    run('pending', 'pending'),
    {
      ...run('running', 'pending'),
      effect: { state: 'pending', at: old, lease_owner: 'worker' },
    },
    run('recent', 'done', recent),
    run('missing', 'done', ''),
    { ...run('kept'), item: {} },
    { entity: { eid: 'cache' }, cache: { old: true }, item: {} },
    { entity: { eid: 'unrelated' }, item: {} },
  ], { trusted: true })
  let sizes: number[] = []
  let door: Access = {
    ...g,
    apply: (bs, o) => {
      sizes.push(bs.length)
      return g.apply(bs, o)
    },
  }
  equal(await expire(door, { batch: 2, now }), 4)
  ok(sizes.every((n) => n <= 2))
  for (let eid of ['done', 'failed']) ok((await g.get([eid]))[0].tombstone)
  for (let eid of ['pending', 'running', 'recent', 'missing']) {
    ok((await g.get([eid]))[0].effect)
  }
  for (let eid of ['kept', 'cache', 'unrelated']) {
    ok((await g.get([eid]))[0].item)
  }
  equal((await g.get(['kept']))[0].effect, undefined)
  equal((await g.get(['cache']))[0].cache, undefined)
  equal(await expire(door, { now }), 0)
})

test('expire reselects if a matched run is revived between reading and applying', async () => {
  let g = make()
  await g.apply([run('revived'), run('done')], { trusted: true })
  let race = true
  let door: Access = {
    ...g,
    apply: async (bs, o) => {
      if (race) {
        race = false
        await g.apply([run('revived', 'pending')], { trusted: true })
      }
      return g.apply(bs, o)
    },
  }
  equal(await expire(door, { now }), 1)
  equal(((await g.get(['revived']))[0].effect as Comp)?.state, 'pending')
})

test('daily duty sweeps on startup, only once before a day elapses, and again the next day', async () => {
  let g = make()
  let clock = now
  await g.apply([run('first')], { trusted: true })
  await expireDaily(g, { owner: 'worker', now: () => clock })
  ok((await g.get(['first']))[0].tombstone)
  await g.apply([run('next')], { trusted: true })
  await expireDaily(g, { owner: 'worker', now: () => clock })
  await expireDaily(g, { owner: 'rival', now: () => clock })
  ok((await g.get(['next']))[0].effect)
  clock += DAY
  await expireDaily(g, { owner: 'rival', now: () => clock })
  ok((await g.get(['next']))[0].tombstone)
})

test('a failed daily sweep leaves a short recoverable hold, not a day-long success', async () => {
  let g = make()
  await g.apply([run('retry')], { trusted: true })
  let door: Access = {
    ...g,
    apply: (bs, o) => {
      if (bs.some((b) => b.effect === null)) throw Error('storage failure')
      return g.apply(bs, o)
    },
  }
  try {
    await expireDaily(door, { owner: 'one', now: () => now })
    throw Error('expected failure')
  } catch (e) {
    equal((e as Error).message, 'storage failure')
  }
  let lease = (await g.get([leaseEid(EXPIRE)]))[0].lease as Comp
  ok(Date.parse(String(lease?.until)) < now + DAY)
  await expireDaily(g, { owner: 'two', now: () => now + DAY })
  ok((await g.get(['retry']))[0].tombstone)
})

test('a worker that stays up runs generic expiration without a registered component handler', async () => {
  let storage = ram(vocab)
  let stop = new AbortController()
  let fx = effects(vocab, { owner: 'worker', now: () => now })
  let g = graph({ vocab, storage, plugins: [fx] })
  await g.apply([{ entity: { eid: 'worker' }, item: {} }, run('old')], {
    trusted: true,
  })
  let door: Access = {
    ...g,
    apply: async (bs, o) => {
      let out = await g.apply(bs, o)
      if (bs.some((b) => b.effect === null)) stop.abort()
      return out
    },
  }
  await fx.work(door, stop.signal)
  ok((await g.get(['old']))[0].tombstone)
})

// Both declarations already hold rows: rejection and cancellation must keep them.
let invalidVocab = loadVocab({
  $defs: { item: { component: true, expire: '.item .count' } },
})
let invalid = graph({ vocab: invalidVocab, storage: ram(invalidVocab) })
await invalid.apply([{ entity: { eid: 'one' }, item: {} }])
let cancelled = make()
await cancelled.apply([run('one')], { trusted: true })

test('expiration rejects nonfilter declarations and aborts before removing rows', async () => {
  try {
    await expire(invalid)
    throw Error('expected rejection')
  } catch (e) {
    equal((e as Error).message, 'item expire must be a filter query')
  }
  equal(await expire(cancelled, { signal: AbortSignal.abort(), now }), 0)
  ok((await cancelled.get(['one']))[0].effect)
})
