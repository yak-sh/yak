// A single-owner store drains recorded runs without distributed claims or
// incarnation start-up work. Durable attempts still distinguish a crash from
// a reported failure, and the same pool bounds handlers in either mode.
import { type Bundle, type Comp, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, ok, test, until } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { effects, type Opts } from './registry.ts'
import { pooledBlog } from './testing.ts'

let vocab = loadVocab([...pooledBlog.docs, {
  $defs: { boot: { effect: true, start: true } },
}])
let store = () => ram(vocab)
let proc = (storage: Storage = store(), opts: Partial<Opts> = {}) => {
  let ran: string[] = []
  let errors: unknown[] = []
  let writes: Bundle[] = []
  let fx = effects(vocab, {
    singleOwner: true,
    defer: true,
    write: (b) => g.apply(b, { trusted: true }),
    report: (e) => void errors.push(e),
    ...opts,
  })
  let g = graph({ storage, vocab, plugins: [fx] })
  let apply = g.apply
  g.apply = async (b, o) => {
    let result = await apply(b, o)
    writes.push(...result)
    return result
  }
  fx.handle({
    post_note: (e) => void ran.push(e.entity.eid),
    post_gone: (e) => void ran.push(`gone ${e.entity.eid}`),
    post_swept: () => void ran.push('sweep'),
    boot: () => void ran.push('boot'),
  })
  return { g, fx, writes, ran, errors }
}
let post = (eid: string) => ({ entity: { eid }, post: { title: 'One' } })
let runs = async (a: ReturnType<typeof proc>) =>
  (await a.g.read('.effect')).map((b) => b.effect as Comp)
let effectWrites = (a: ReturnType<typeof proc>) =>
  a.writes.filter((b) => b.effect).map((b) => b.effect as Comp)
let noLeases = (a: ReturnType<typeof proc>) => {
  ok(!a.writes.some((b) => b.lease))
  for (let row of effectWrites(a)) {
    ok(!Object.keys(row).some((key) => key.startsWith('lease_')))
  }
}

test('single owner empty wakes owe no start or sweep work and write nothing', async () => {
  let a = proc()
  await a.g.apply([post('p1')])
  await a.fx.work(a.g)
  equal(a.ran.sort(), ['p1', 'sweep']) // Only the runs this commit owed.
  a.writes.length = 0
  let next = proc(a.g.storage)
  for (let i = 0; i < 3; i++) await next.fx.work(next.g)
  equal(next.ran, [])
  equal(next.writes, [])
  equal(await next.g.read('.lease'), [])
})

test('single owner recorded success writes only attempt and outcome, without lease fields', async () => {
  let a = proc()
  await a.g.apply([post('p1')])
  noLeases(a)
  a.writes.length = 0
  await a.fx.work(a.g)
  equal(effectWrites(a).length, 2) // Two attempts; successes delete.
  equal(await runs(a), [])
  noLeases(a)
  equal(a.errors, [])
})

// Joining the empty pool is fixture setup; the write must start its own runs.
let writer = proc(store(), { defer: false })
await writer.fx.work(writer.g)

test('single owner writer-started runs contain no distributed claim', async () => {
  let a = writer
  await a.g.apply([post('p1')])
  await a.fx.idle()
  equal(a.ran.sort(), ['p1', 'sweep'])
  noLeases(a)
  equal(await runs(a), [])
})

test('single owner retries keep backoff and attempt limits without lease churn', async () => {
  let t = 0
  let a = proc(store(), { now: () => t, backoff: () => 10 })
  a.fx.handle({
    post_note: () => {
      throw Error('failed')
    },
  })
  await a.g.apply([post('p1')])
  a.writes.length = 0
  await a.fx.work(a.g)
  let note = () =>
    runs(a).then((rs) => rs.find((r) => r.handler == 'post_note')!)
  equal((await note()).attempts, 1)
  equal((await note()).next, new Date(10).toISOString())
  let count = effectWrites(a).length
  await a.fx.work(a.g)
  equal(effectWrites(a).length, count)
  t = 10
  await a.fx.work(a.g)
  equal((await note()).state, 'failed')
  equal((await note()).attempts, 2)
  equal(effectWrites(a).length, count + 2)
  noLeases(a)
})

for (let legacy of [false, true]) {
  test(`single owner recovers interrupted runs without replaying unsafe work (legacy ${legacy})`, async () => {
    let a = proc()
    await a.g.apply([
      { entity: { eid: 'p1' } },
      { entity: { eid: 'old' } },
    ])
    // Recorded just before a crash. Legacy claims must not delay the sole owner.
    for (
      let [id, handler] of [['safe', 'post_note'], ['unsafe', 'post_gone']]
    ) {
      await a.g.apply([{
        entity: { eid: id },
        effect: {
          handler,
          target: 'p1',
          comp: 'post',
          kind: 'created',
          state: 'pending',
          attempts: 1,
          ...(legacy
            ? {
              lease_owner: 'old',
              lease_token: 'old-token',
              lease_expiry: new Date(1_000_000).toISOString(),
            }
            : {}),
        },
      }], { trusted: true })
    }
    a.writes.length = 0
    await a.fx.work(a.g)
    equal(a.ran, ['p1'])
    let rs = await runs(a)
    equal(rs.find((r) => r.handler == 'post_note'), undefined)
    equal(rs.find((r) => r.handler == 'post_gone')?.state, 'failed')
    equal(effectWrites(a).length, 2)
    noLeases(a)
  })
}

for (let singleOwner of [true, false]) {
  test(`pool capacity and overlapping drains run each owed handler once (${singleOwner})`, async () => {
    let a = proc(store(), { singleOwner, max: 2 })
    let release = Promise.withResolvers<void>()
    let active = 0, peak = 0
    a.fx.handle({
      post_note: async (e) => {
        peak = Math.max(peak, ++active)
        a.ran.push(e.entity.eid)
        await release.promise
        active--
      },
      post_swept: () => {},
      boot: () => {},
    })
    await a.g.apply([post('p1'), post('p2'), post('p3')])
    let draining = a.fx.work(a.g)
    await until(() => active == 2)
    let other = a.fx.work(a.g)
    release.resolve()
    await Promise.all([draining, other])
    await a.fx.idle()
    equal(a.ran.sort(), ['p1', 'p2', 'p3'])
    equal(peak, 2)
    equal(a.errors, [])
    if (singleOwner) noLeases(a)
  })
}

test('single owner live work and idle never renew claims or take presence duties', async () => {
  let t = 0
  let a = proc(store(), { owner: 'sole', lease: 4, now: () => t })
  let release = Promise.withResolvers<void>()
  a.fx.handle({
    post_note: async () => {
      await release.promise
    },
  })
  await a.g.apply([post('p1')])
  a.writes.length = 0
  let signal = new AbortController()
  let serving = a.fx.work(a.g, signal.signal)
  await until(() => a.fx.running().some((r) => r.handler == 'post_note'))
  t = 1_000_000
  a.fx.wake()
  // Wait for a pass, without sleeping: work's pending read marks the boundary.
  let read = a.g.read
  let passed = Promise.withResolvers<void>()
  a.g.read = (...args) => {
    passed.resolve()
    return read(...args)
  }
  await passed.promise
  signal.abort()
  await serving
  let count = effectWrites(a).length
  let waiting = a.fx.idle()
  release.resolve()
  await waiting
  equal(effectWrites(a).length, count)
  noLeases(a)
  equal(a.errors, [])
})

test('single owner progress restores attempts before a later failure', async () => {
  let t = 0, calls = 0
  let a = proc(store(), { now: () => t, backoff: () => 10 })
  a.fx.handle({
    post_note: async (_e, _tx, _write, attempt) => {
      calls++
      if (calls == 2) {
        if (!attempt) throw Error('missing pooled attempt')
        ok(attempt.last())
        await attempt.progressed()
        ok(!attempt.last())
      }
      if (calls <= 2) throw Error('later failure')
    },
  })
  await a.g.apply([post('p1')])
  a.writes.length = 0
  await a.fx.work(a.g)
  t = 10
  await a.fx.work(a.g)
  let note = () =>
    runs(a).then((rs) => rs.find((r) => r.handler == 'post_note')!)
  equal((await note()).attempts, 1)
  equal((await note()).state, 'pending')
  t = 20
  await a.fx.work(a.g)
  equal(calls, 3)
  equal(await note(), undefined)
  noLeases(a)
  equal(a.errors.length, 2)
})
