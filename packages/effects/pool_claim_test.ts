import {
  type Access,
  type Bundle,
  type Comp,
  dead,
  detached,
  guard,
} from '@yaks/graph'
import { after, system } from '@yaks/fp'
import { matcher } from '@yaks/match'
import { equal, test, throws } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { memory } from '../graph/testing.ts'
import { effectDoc, pool, type PoolOpts } from './pool.ts'
import { effects } from './registry.ts'

let vocab = loadVocab([pick(effectDoc, ['effect']), {
  $defs: {
    alpha: { effect: true, start: true, changed: ['post'] },
    beta: { effect: true, start: true, changed: ['post'] },
    post: { component: true },
  },
}])

test('a pool rejects a window that cannot make bounded progress', async () => {
  for (let page of [0, -1, 0.5, Infinity, NaN]) {
    await throws(() =>
      pool({
        slots: () => [],
        writer: () => () => [],
        report: () => {},
      }, { page }), /positive integer/)
  }
})
let plans = new WeakMap<typeof vocab, Map<string, ReturnType<typeof matcher>>>()

let worker = (
  ids = ['a1', 'b1'],
  opts: Partial<PoolOpts> = {},
  words = vocab,
) => {
  let storage = memory(), eids = new Set<string>()
  let tx = <T>(body: Parameters<typeof storage.tx<T>>[0]) =>
    storage.tx((t) =>
      body({
        ...t,
        patch: (bs) => {
          for (let b of bs) eids.add(b.entity.eid)
          return t.patch(bs)
        },
      })
    )
  let read: Access['read'] = (q, opts) => {
    let held = plans.get(words)
    if (!held) plans.set(words, held = new Map())
    let key = JSON.stringify([q, opts]), match = held.get(key)
    if (!match) held.set(key, match = matcher(q, words, opts))
    return match(storage.get([...eids]) as Bundle[])
  }
  let g: Access = {
    vocab: words,
    outside: detached({ ...storage, read }),
    get: storage.get,
    read,
    rows: (q, opts) => read(q, opts),
    apply: (bs) =>
      tx((t) =>
        after(guard(bs, t, words), (ready) => {
          // A guarded edit that lost to deletion is not a committed claim.
          let kept = ready.filter((b) =>
            !b.$was || !(storage.get([b.entity.eid]) as Bundle[]).some(dead)
          )
          t.remove(kept.filter(dead).map((b) => b.entity))
          t.patch(kept.filter((b) => !dead(b)))
          return kept
        })
      ),
  }
  let fx = effects(words), errors: unknown[] = []
  let p = pool({
    slots: fx.slots,
    writer: () => (bs) => g.apply(bs),
    report: (e) => void errors.push(e),
  }, { startup: 'manual', max: 2, ...opts })
  let seed = (ids: string[]) =>
    tx((t) =>
      t.patch(ids.map((eid) => ({
        entity: { eid },
        effect: {
          handler: eid[0] == 'a' ? 'alpha' : 'beta',
          target: eid,
          kind: 'changed',
          comp: 'post',
          state: 'pending',
          attempts: 0,
        },
      })))
    )
  seed(ids)
  return { g, p, fx, tx, errors }
}

let window = async (w: ReturnType<typeof worker>) => {
  let seen: string[] = [],
    claims: number[] = [],
    observations: unknown[] = [],
    owedCounts: number[] = []
  let write = w.g.apply, released = Promise.withResolvers<void>()
  let began = Promise.withResolvers<void>()
  let run = async (e: { entity: { eid: string } }) => {
    seen.push(e.entity.eid)
    observations.push(
      (await w.g.get(['a1', 'b1'])).map((b) => (b.effect as Comp).attempts),
    )
    if (seen.length == 2) began.resolve()
    return released.promise
  }
  w.fx.handle({ alpha: run, beta: run })
  w.g.apply = async (bs, opts) => {
    if (bs.some((b) => (b.effect as Comp)?.attempts == 1)) {
      claims.push(bs.length)
      // A concurrent writer must leave new work unclaimed while this pass
      // has reserved both slots, even before either handler begins.
      let owed = await w.tx((t) =>
        w.p.owe(t, [[w.fx.slots()[0], {
          kind: 'changed',
          entity: { eid: 'new' },
          name: 'post',
        }]], 0)
      )
      owedCounts.push(owed.length)
    }
    return write(bs, opts)
  }
  let pass = w.p.work(w.g, undefined, 1)
  await began.promise
  let active = w.p.running().length
  released.resolve()
  await pass
  return {
    seen,
    claims,
    observations,
    owedCounts,
    active,
    ended: w.p.running(),
    errors: w.errors,
  }
}
await window(worker(['a1', 'a2', 'b1']))
let fairHost = worker(['a1', 'a2', 'b1'])
test('a pool commits its fair claim window before handlers and reserves the concurrency slots', async () => {
  equal(await window(fairHost), {
    seen: ['a1', 'b1'],
    claims: [2],
    observations: [[1, 1], [1, 1]],
    owedCounts: [0],
    active: 2,
    ended: [],
    errors: [],
  })
})

let raced = async (w: ReturnType<typeof worker>, removed: boolean) => {
  let seen: string[] = []
  w.fx.handle({ alpha: () => seen.push('a'), beta: () => seen.push('b') })
  let write = w.g.apply, stolen = false
  w.g.apply = async (bs, opts) => {
    if (!stolen && bs.some((b) => (b.effect as Comp)?.attempts == 1)) {
      stolen = true
      await write([{
        entity: { eid: 'a1' },
        ...removed ? { $delete: true } : {
          effect: { attempts: 1, lease_token: 'other', lease_owner: 'other' },
        },
      }])
    }
    return write(bs, opts)
  }
  await w.p.work(w.g, undefined, 1)
  return { seen, errors: w.errors }
}
for (let removed of [false, true]) {
  await raced(worker(), removed)
  let host = worker()
  test(`a ${removed ? 'deleted' : 'stolen'} claim does not block the other rows in its window`, async () => {
    equal(await raced(host, removed), { seen: ['b'], errors: [] })
  })
}

let refused = async (w: ReturnType<typeof worker>) => {
  w.fx.handle({ alpha: () => {}, beta: () => {} })
  w.g.apply = () => Promise.reject(Error('unavailable'))
  let error = await w.p.work(w.g, undefined, 1).then(
    () => null,
    (e) => e.message,
  )
  let owed = await w.tx((t) =>
    w.p.owe(t, [[w.fx.slots()[0], {
      kind: 'changed',
      entity: { eid: 'new' },
      name: 'post',
    }]], 0)
  )
  return { error, owed: owed.length, attempts: owed[0]?.row.attempts }
}
await refused(worker())
let refusedHost = worker()
test('a refused claim batch releases its reserved slots for later writes', async () => {
  equal(await refused(refusedHost), {
    error: 'unavailable',
    owed: 1,
    attempts: 1,
  })
})

let filled = async (w: ReturnType<typeof worker>) => {
  let released = Promise.withResolvers<void>(), seen: string[] = []
  w.fx.handle({
    alpha: (e) => {
      seen.push(e.entity.eid)
      if (e.entity.eid == 'new') return released.promise
      released.resolve()
    },
  })
  let read = w.g.read, injected = false
  w.g.read = async (q, opts) => {
    let found = await read(q, opts)
    if (!injected) {
      injected = true
      let owed = await w.tx((t) =>
        w.p.owe(t, [[w.fx.slots()[0], {
          kind: 'changed',
          entity: { eid: 'new' },
          name: 'post',
        }]], 0)
      )
      w.p.start(owed)
    }
    return found
  }
  await w.p.work(w.g, undefined, 1)
  let result = {
    seen: [...seen],
    running: w.p.running().length,
    attempts:
      ((await w.g.get(['a1']))[0]?.effect as Comp | undefined)?.attempts ??
        null,
  }
  released.resolve()
  await w.p.idle()
  return result
}
await filled(worker(['a1'], { max: 1 }))
let filledHost = worker(['a1'], { max: 1 })
test('a writer filling a slot during selection leaves the candidate pending', async () => {
  equal(await filled(filledHost), { seen: ['new'], running: 1, attempts: 0 })
})

let leaving = async (w: ReturnType<typeof worker>) => {
  let up = new AbortController(), seen: string[] = [], read = w.g.read
  w.fx.handle({ alpha: (e) => void seen.push(e.entity.eid), beta: () => {} })
  w.g.read = async (q, opts) => {
    let rows = await read(q, opts)
    up.abort()
    return rows
  }
  await w.p.work(w.g, up.signal)
  return {
    seen,
    attempts:
      ((await w.g.get(['a1']))[0]?.effect as Comp | undefined)?.attempts ??
        null,
  }
}
await leaving(worker(['a1'], { singleOwner: true }))
let leavingHost = worker(['a1'], { singleOwner: true })
test('leaving during selection never persists an uncommitted claim', async () => {
  equal(await leaving(leavingHost), { seen: [], attempts: 0 })
})

let delivered = async (w: ReturnType<typeof worker>) => {
  let seen: string[] = [], snapshots: unknown[] = [], claims = 0
  let run = async (name: string) => {
    seen.push(name)
    snapshots.push(
      (await w.g.read('.effect')).map((b) => (b.effect as Comp).attempts),
    )
  }
  w.fx.handle({ alpha: () => run('a'), beta: () => run('b') })
  let apply = w.g.apply
  w.g.apply = (bs, opts) => {
    claims +=
      bs.filter((b) =>
        (b.effect as Comp)?.attempts == 1 && !(b.effect as Comp)?.handler
      ).length
    return apply(bs, opts)
  }
  await w.p.work(w.g, undefined, { startup: true, passes: 1 })
  return { seen, snapshots, claims, left: await w.g.read('.effect') }
}
for (let singleOwner of [false, true]) {
  await delivered(worker([], { singleOwner, startup: 'join' }))
  let host = worker([], { singleOwner, startup: 'join' })
  // A single-owner host owes the pass again until it ends, so the runs it
  // starts keep no row; a shared worker's claims are rows the others read.
  test(`explicit startup records its claims with the runs without doubling joining startup (${singleOwner})`, async () => {
    equal(await delivered(host), {
      seen: ['a', 'b'],
      snapshots: singleOwner ? [[], []] : [[1, 1], [1, 1]],
      claims: 0,
      left: [],
    })
  })
}

let retried = async (w: ReturnType<typeof worker>, clock: { now: number }) => {
  let seen: string[] = [], fail = true
  w.fx.handle({
    alpha: () => {
      seen.push('a')
      if (fail) throw Error('not yet')
    },
    beta: () => void seen.push('b'),
  })
  await w.p.work(w.g, undefined, { startup: true, passes: 1 })
  let kept = (await w.g.read('.effect')).map((b) => {
    let { handler, state, attempts, next } = b.effect as Comp
    return { handler, state, attempts, next }
  })
  fail = false
  clock.now = 1000
  await w.p.work(w.g, undefined, 1)
  return { seen, kept, left: await w.g.read('.effect') }
}
let failing = () => {
  let clock = { now: 0 }
  return [
    worker([], {
      singleOwner: true,
      clock: { ...system, now: () => clock.now },
    }),
    clock,
  ] as const
}
await retried(...failing())
let failingHost = failing()
test('a single-owner startup run that fails is the row its retry reads', async () => {
  equal(await retried(...failingHost), {
    seen: ['a', 'b', 'a'],
    kept: [{
      handler: 'alpha',
      state: 'pending',
      attempts: 1,
      next: new Date(1000).toISOString(),
    }],
    left: [],
  })
})

let overflow = async (w: ReturnType<typeof worker>) => {
  let seen: string[] = [],
    begun = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  w.fx.handle({
    alpha: () => {
      seen.push('a')
      begun.resolve()
      return release.promise
    },
    beta: () => void seen.push('b'),
  })
  let first = w.p.work(w.g, undefined, { startup: true, passes: 1 })
  await begun.promise
  let attempts = (await w.g.read('.effect')).map((b) =>
    (b.effect as Comp).attempts
  )
  release.resolve()
  await first
  await w.p.work(w.g, undefined, 1)
  return { seen, attempts, left: await w.g.read('.effect') }
}
await overflow(worker([], { singleOwner: true, max: 1 }))
let overflowHost = worker([], { singleOwner: true, max: 1 })
test('startup persists capacity overflow pending for a later fair pass', async () => {
  equal(await overflow(overflowHost), {
    seen: ['a', 'b'],
    attempts: [0],
    left: [],
  })
})

let failedStart = async (w: ReturnType<typeof worker>) => {
  let seen: string[] = [], write = w.g.apply
  w.fx.handle({
    alpha: () => void seen.push('a'),
    beta: () => void seen.push('b'),
  })
  w.g.apply = () => Promise.reject(Error('unavailable'))
  await throws(
    () => w.p.work(w.g, undefined, { startup: true, passes: 1 }),
    'unavailable',
  )
  let failed = [...seen]
  w.g.apply = write
  await w.p.work(w.g, undefined, { startup: true, passes: 1 })
  return { failed, retried: seen }
}
await failedStart(worker([]))
let failedStartHost = worker([])
test('failed startup persistence starts nothing and releases capacity for retry', async () => {
  equal(await failedStart(failedStartHost), { failed: [], retried: ['a', 'b'] })
})

let emptyHost = worker([])
emptyHost.fx.handle({ alpha: () => {}, beta: () => {} })
test('an empty pool discovers no handler windows', async () => {
  let reads = 0, read = emptyHost.g.read
  emptyHost.g.read = (q, opts) => {
    reads++
    return read(q, opts)
  }
  await emptyHost.p.work(emptyHost.g, undefined, 1)
  equal(emptyHost.p.running(), [])
  equal(reads, 1)
})

let boundedWords = loadVocab([pick(effectDoc, ['effect']), {
  $defs: Object.fromEntries(
    Array.from(
      { length: 3 },
      (_, n) => [`start_${n}`, { effect: true, start: true }],
    ),
  ),
}])
let bounded = async (w: ReturnType<typeof worker>) => {
  let seen = 0
  let rows = w.g.rows
  // An asynchronous discovery read can resolve after fast start-up handlers
  // have settled. Their freed slots still belong to this pass's window.
  w.g.rows = async (q, opts) => {
    for (let n = 0; n < 4; n++) await Promise.resolve()
    return rows(q, opts)
  }
  w.fx.handle(
    Object.fromEntries(w.fx.slots().map((s) => [s.id, () => void seen++])),
  )
  await w.p.work(w.g, undefined, { startup: true, passes: 1 })
  let first = seen
  let pending = (await w.g.read('.effect')).map((b) =>
    (b.effect as Comp).attempts
  )
  await w.p.work(w.g, undefined, 1)
  return { first, pending, total: seen, left: await w.g.read('.effect') }
}
await bounded(worker([], { max: 4, page: 2, singleOwner: true }, boundedWords))
let boundedHost = worker(
  [],
  { max: 4, page: 2, singleOwner: true },
  boundedWords,
)
test('startup and discovery share one bounded pass even when handlers finish immediately', async () => {
  equal(await bounded(boundedHost), {
    first: 2,
    pending: [0],
    total: 3,
    left: [],
  })
})

let restricted = async (w: ReturnType<typeof worker>) => {
  let seen: string[] = []
  w.fx.handle({
    alpha: () => void seen.push('a'),
    beta: () => void seen.push('b'),
  })
  await w.p.work(w.g, undefined, { startup: true, passes: 1 })
  let left = (await w.g.read('.effect')).map((b) => {
    let row = b.effect as Comp
    return [row.handler, row.state, row.attempts]
  }).sort()
  return { seen, left }
}
await restricted(worker([], { singleOwner: true, disabled: ['alpha'] }))
let disabledHost = worker([], { singleOwner: true, disabled: ['alpha'] })
test('explicit startup settles disabled runs without invoking their handlers', async () => {
  equal(await restricted(disabledHost), { seen: ['b'], left: [] })
})
await restricted(worker([], { singleOwner: true, tries: 0 }))
let zeroHost = worker([], { singleOwner: true, tries: 0 })
test('explicit startup respects a zero-attempt policy', async () => {
  equal(await restricted(zeroHost), {
    seen: [],
    left: [['alpha', 'failed', 0], ['beta', 'failed', 0]],
  })
})
