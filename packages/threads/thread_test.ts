/// <reference lib="deno.ns" />
import { effects, take } from '@yaks/effects'
import {
  type Bundle,
  type Comp,
  graph,
  match,
  Refused,
  Stale,
  token,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, ok, test, until } from '@yaks/testing'
import { remote, serve } from './graph.ts'
import { thread } from './thread.ts'
import { vocab } from './testing.ts'

let part = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let fixture = () => {
  let fx = effects(vocab)
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
  let worker = thread<{ gated?: boolean; fail?: boolean }>(
    new URL('./testing.ts', import.meta.url),
  )
  return { g, fx, worker }
}

test('a thread claims effects from the owning RAM graph and writes through its rules', async () => {
  let { g, worker } = fixture()
  worker.plan({ roles: ['effects', 'clock'], data: {}, graph: g })
  let stop = new AbortController()
  let live = worker.duties(stop.signal)
  live.catch(() => {})
  try {
    await until(async () => part((await g.get(['clock']))[0], 'mark')?.live, {
      timeout: 5000,
    })
    await g.apply([{ entity: { eid: 'job' }, job: { value: 21 } }])
    worker.nudge()
    await until(async () => (await g.get(['job']))[0]?.answer, {
      timeout: 5000,
    })
    let [answer] = await g.get(['job'])
    equal(answer.answer, { value: 42, by: worker.me })
    ok(answer.admitted)
    await until(async () =>
      part((await g.read('.effect.handler=finish'))[0], 'effect')?.state ==
        'done'
    )
    equal(
      part((await g.read('.effect.handler=finish'))[0], 'effect')?.attempts,
      1,
    )
    equal(
      part((await g.read('.effect.handler=answered'))[0], 'effect')?.state,
      'pending',
    )
    stop.abort()
    await live
    await worker.close()
    equal(part((await g.get(['clock']))[0], 'mark')?.stopped, true)
    await g.apply([{ entity: { eid: 'next' }, job: { value: 1 } }])
    equal((await g.get(['next']))[0].answer, undefined)
  } finally {
    stop.abort()
    worker.end()
  }
})

test('closing a thread drains an effect before closing its graph port', async () => {
  let { g, worker } = fixture()
  worker.plan({ roles: ['effects'], data: { gated: true }, graph: g })
  await g.apply([{ entity: { eid: 'job' }, job: { value: 5 } }])
  let stop = new AbortController()
  let live = worker.duties(stop.signal)
  live.catch(() => {})
  try {
    await until(
      async () =>
        part((await g.read('.effect.handler=finish'))[0], 'effect')
          ?.lease_owner ==
          worker.me,
      { timeout: 5000 },
    )
    let closing = worker.close()
    await g.apply([{ entity: { eid: 'job' }, job: { ready: true } }])
    await closing
    await live
    equal(part((await g.get(['job']))[0], 'answer')?.value, 10)
    equal(
      part((await g.read('.effect.handler=finish'))[0], 'effect')?.state,
      'done',
    )
  } finally {
    stop.abort()
    worker.end()
  }
})

test('a thread reports opening failures and forced termination releases its callers', async () => {
  for (let fail of [true, false]) {
    let { g, worker } = fixture()
    worker.plan({ roles: ['clock'], data: { fail }, graph: g })
    let live = worker.duties(new AbortController().signal)
    live.catch(() => {})
    try {
      if (!fail) {
        await until(
          async () => part((await g.get(['clock']))[0], 'mark')?.live,
          {
            timeout: 5000,
          },
        )
        worker.end()
      }
      let error = await live.then(() => undefined, (error) => error)
      ok(error instanceof Error)
      ok(error.message.includes(fail ? 'opening failed' : 'ended'))
    } finally {
      worker.end()
    }
  }
})

test('remote graph refuses writes and preserves claim conflicts across the port', async () => {
  let { g } = fixture()
  let { port1, port2 } = new MessageChannel()
  let serving = serve(port1, g)
  let client = remote(port2, vocab)
  let rejects = async (
    run: () => unknown,
    type: typeof Refused | typeof Stale,
  ) => {
    let error = await Promise.resolve().then(run).then(
      () => undefined,
      (error) => error,
    )
    ok(error instanceof type)
    return error
  }
  try {
    await client.apply([{ entity: { eid: 'job' }, job: { value: 1 } }])
    await rejects(
      () => client.apply([{ entity: { eid: 'job' }, missing: {} }]),
      Refused,
    )
    let error = await rejects(() =>
      client.apply([{
        entity: { eid: 'job' },
        job: { value: 2 },
        $was: { job: { value: token(0) } },
      }]), Stale)
    equal(error.current, 1)
    equal(part((await client.get(['job']))[0], 'job')?.value, 1)
    equal((await client.rows('.job .count'))[0].n, 1)
    let [bindings] = await client.outside.bindings!(
      [match('.job.value=$value')],
      [],
      ['job'],
    )
    equal(bindings.map((b) => b.vars), [{ value: 1 }])
    await client.apply([{ entity: { eid: 'a' } }, { entity: { eid: 'b' } }])
    let outcomes = await Promise.all(
      ['a', 'b'].map((holder) => take(client, 'clock', { holder })),
    )
    equal(outcomes.filter(Boolean).length, 1)
  } finally {
    client.close()
    serving.close()
    port1.close()
    port2.close()
  }
})

test('one pass, an early abort, and closing an unstarted thread settle without live work', async () => {
  for (let early of [false, true]) {
    let { g, worker } = fixture()
    let stop = new AbortController()
    stop.abort()
    let pass = early ? worker.duties(stop.signal) : undefined
    worker.plan({ roles: ['clock'], data: {}, graph: g })
    try {
      await (pass ?? worker.duties(stop.signal))
      equal(part((await g.get(['clock']))[0], 'mark'), {
        live: false,
        stopped: true,
      })
      await worker.close()
    } finally {
      worker.end()
    }
  }
  let { g, worker } = fixture()
  worker.plan({ roles: ['clock'], data: {}, graph: g })
  await worker.close()
  let error = await worker.duties(AbortSignal.abort()).catch((error) => error)
  ok(error instanceof Error)
  equal(await g.get(['clock']), [])
})

test('two threads race for one owed effect and only one handler writes', async () => {
  let { g, fx, worker: first } = fixture()
  let second = thread<{ gated?: boolean }>(
    new URL('./testing.ts', import.meta.url),
  )
  let writes = 0
  fx.changed('answer', () => writes++)
  fx.created('answer', () => writes++)
  await g.apply([{ entity: { eid: 'job' }, job: { value: 7 } }])
  let stop = new AbortController()
  let serving = [first, second].map((worker) => {
    worker.plan({ roles: ['effects'], data: {}, graph: g })
    let running = worker.duties(stop.signal)
    running.catch(() => {})
    return running
  })
  try {
    await until(
      async () =>
        part((await g.read('.effect.handler=finish'))[0], 'effect')?.state ==
          'done',
      { timeout: 5000 },
    )
    stop.abort()
    await Promise.all(serving)
    await Promise.all([first.close(), second.close()])
    equal(writes, 1)
    equal(part((await g.get(['job']))[0], 'answer')?.value, 14)
  } finally {
    stop.abort()
    first.end()
    second.end()
  }
})

test('overlapping duty calls are refused while the first can still stop', async () => {
  let { g, worker } = fixture()
  worker.plan({ roles: ['clock'], data: {}, graph: g })
  let stop = new AbortController()
  let live = worker.duties(stop.signal)
  live.catch(() => {})
  try {
    await until(async () => part((await g.get(['clock']))[0], 'mark')?.live, {
      timeout: 5000,
    })
    let error = await worker.duties(stop.signal).catch((error) => error)
    ok(error instanceof Error)
    ok(error.message.includes('already serving'))
    stop.abort()
    await live
    await worker.close()
    equal(part((await g.get(['clock']))[0], 'mark')?.stopped, true)
  } finally {
    stop.abort()
    worker.end()
  }
})

test('aborting live work during opening starts no one-shot duty', async () => {
  let { g, worker } = fixture()
  worker.plan({ roles: ['clock'], data: {}, graph: g })
  let stop = new AbortController()
  let live = worker.duties(stop.signal)
  stop.abort()
  try {
    await live
    await worker.close()
    equal(await g.get(['clock']), [])
  } finally {
    worker.end()
  }
})

test('a completed pass can be followed by live duties', async () => {
  let { g, worker } = fixture()
  worker.plan({ roles: ['clock'], data: {}, graph: g })
  let stop = new AbortController()
  try {
    await worker.duties(AbortSignal.abort())
    equal(part((await g.get(['clock']))[0], 'mark')?.live, false)
    let live = worker.duties(stop.signal)
    live.catch(() => {})
    await until(async () => part((await g.get(['clock']))[0], 'mark')?.live, {
      timeout: 5000,
    })
    stop.abort()
    await live
    await worker.close()
  } finally {
    stop.abort()
    worker.end()
  }
})
