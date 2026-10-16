import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import type { Item, Model, Request } from '@yaks/model'
import { react, statusOf } from '@yaks/session'
import { test, until } from '@yaks/testing'
import { agent, lend, seed } from './agent.ts'
import { harness } from './testing.ts'

// Prepare each independent real graph/effects scenario before cases are timed.
// A case checks captured decisions/outcomes, not worker startup, polling latency
// or SQLite round-trips. Capture values when observed (not closures over mutable
// requests), so a later final cannot make an earlier progress assertion pass.
let observed = async (
  name: string,
  prepare: (check: {
    equal: (actual: unknown, expected: unknown) => void
    ok: (condition: unknown, message?: string) => void
  }) => Promise<void>,
) => {
  const checks: (() => void)[] = []
  let failure: unknown
  try {
    await prepare({
      equal: (actual, expected) => {
        const a = structuredClone(actual), b = structuredClone(expected)
        checks.push(() => assertEquals(a, b))
      },
      ok: (condition, message) => {
        const value = !!condition
        checks.push(() => assert(value, message))
      },
    })
  } catch (error) {
    failure = error
  }
  test(name, () => {
    if (failure) throw failure
    assert(checks.length > 0, 'the prepared scenario must have observations')
    for (const check of checks) check()
  })
}

// The promises are the clock: neither completion depends on a process, provider,
// sleep or timeout. Only the effects worker and graph are real.
let deferred = <T>() => {
  let resolve!: (value: T) => void
  let promise = new Promise<T>((done) => resolve = done)
  return { promise, resolve }
}
let body = (b: Bundle) => (b.content as Comp | undefined)?.body
let final = (req: Request, text: string) =>
  req.items.some((item) =>
    item.kind == 'result' && item.output.includes(text) ||
    item.kind == 'user' && item.text.includes(text)
  )

const h = await harness()

await observed(
  'native async effects overlap, accept steering and append late results without polling',
  async ({ equal, ok }) => {
    let slow = deferred<string>()
    let fast = deferred<string>()
    let started: string[] = []
    let requests: Request[] = []
    let failures: unknown[] = []
    let tools = ['slow', 'fast'].map((name) => ({
      name,
      description: 'A deferred test tool',
      parameters: { type: 'object' },
      run: () => {
        started.push(name)
        return (name == 'slow' ? slow : fast).promise
      },
    }))
    let model: Model = (req) => {
      requests.push({ ...req, items: structuredClone(req.items) })
      let items: Item[] = requests.length == 1
        ? ['slow', 'fast'].map((name) => ({
          kind: 'call',
          id: name,
          name,
          args: '{}',
        }))
        : [{ kind: 'assistant', text: 'I can continue while tools run.' }]
      return Promise.resolve({
        id: `reply-${requests.length}`,
        model: req.model,
        items,
      })
    }
    let opts = {
      h,
      name: 'fake',
      tools,
      model,
      report: (e: unknown) => {
        failures.push(e)
      },
    }
    let a = agent(opts)
    try {
      let s = await a.start('start two tools')
      await until(() =>
        started.includes('slow') && started.includes('fast') &&
        requests.length >= 2
      )
      let progress = await a.transcript(s)
      let calls = progress.filter((b) => b.call)
      equal(calls.length, 2)
      ok(calls.every((b) => b.tool_async))
      equal(progress.filter((b) => b.tool_progress).length, 2)
      equal(progress.filter((b) => b.result).length, 0)

      // A runner pass while both calls are held must yield, not ask the model
      // again or wait on the tools. This assertion has no elapsed-time threshold.
      await until(async () =>
        (await a.transcript(s)).some((b) =>
          body(b) == 'I can continue while tools run.'
        )
      )
      let count = requests.length
      for (let i = 0; i < 3; i++) {
        equal((await react(h.g, s, lend(opts))).did, 'nothing')
      }
      equal(requests.length, count)

      await a.send(s, 'steer while both tools are pending')
      await until(() => requests.some((r) => final(r, 'steer while both')))
      equal((await a.transcript(s)).filter((b) => b.result).length, 0)

      // The second call completes first. It wakes a model that has already
      // answered the steering input, without waiting for the first call.
      fast.resolve('FAST_FINAL')
      await until(() => requests.some((r) => final(r, 'FAST_FINAL')))
      equal((await a.transcript(s)).filter((b) => b.result).length, 1)
      slow.resolve('SLOW_FINAL')
      await until(() => requests.some((r) => final(r, 'SLOW_FINAL')))
      await until(async () => statusOf(await a.transcript(s)) == 'settled')
      let entries = await a.transcript(s)
      equal(statusOf(entries), 'settled')
      equal(entries.filter((b) => b.result).length, 2)
      equal(
        entries.filter((b) => b.tool_progress),
        progress.filter((b) => b.tool_progress),
      )
      for (let call of calls) {
        equal(
          entries.filter((b) =>
            (b.result as Comp | undefined)?.call == call.entity.eid
          ).length,
          1,
        )
      }
      ok(entries.some((b) => String(body(b)).includes('FAST_FINAL')))
      ok(entries.some((b) => String(body(b)).includes('SLOW_FINAL')))

      // Every ask extends the previous wire prefix. In-progress result items
      // stay byte-for-byte in place; final updates append rather than replace them.
      for (let i = 1; i < requests.length; i++) {
        let previous = requests[i - 1].items
        equal(requests[i].items.slice(0, previous.length), previous)
        equal(requests[i].conversation, requests[0].conversation)
      }
      equal([...started].sort(), ['fast', 'slow'])
      equal(failures, [])
    } finally {
      slow.resolve('SLOW_FINAL')
      fast.resolve('FAST_FINAL')
      await a.close()
    }
  },
)

const heldHost = await harness()

await observed(
  'a final during a held ask does not interrupt it or rewrite its wire prefix',
  async ({ equal }) => {
    let tool = deferred<string>()
    let reply = deferred<Awaited<ReturnType<Model>>>()
    let requests: Request[] = []
    let runs = 0
    let opts = {
      h: heldHost,
      name: 'held-model',
      tools: [{
        name: 'held-tool',
        description: 'Deferred tool',
        parameters: { type: 'object' },
        run: () => {
          runs++
          return tool.promise
        },
      }],
      model: ((req) => {
        requests.push({ ...req, items: structuredClone(req.items) })
        if (requests.length == 2) return reply.promise
        return Promise.resolve({
          id: `held-${requests.length}`,
          model: req.model,
          items: requests.length == 1
            ? [{ kind: 'call', id: 'held', name: 'held-tool', args: '{}' }]
            : [{ kind: 'assistant', text: 'saw final' }],
        })
      }) as Model,
    }
    let a = agent(opts)
    try {
      let s = await a.start('hold a model ask while a tool completes')
      await until(() => runs == 1 && requests.length == 2)
      tool.resolve('FINAL_DURING_ASK')
      await until(async () => (await a.transcript(s)).some((b) => b.result))
      let held = await a.transcript(s)
      equal(held.filter((b) => b.ask).length, 2)
      equal(held.filter((b) => b.interrupted).length, 0)
      equal(requests.length, 2)
      reply.resolve({
        id: 'held-2',
        model: 'held-model',
        items: [{ kind: 'assistant', text: 'held reply' }],
      })
      await until(() => requests.some((r) => final(r, 'FINAL_DURING_ASK')))
      await until(async () => statusOf(await a.transcript(s)) == 'settled')
      equal(runs, 1)
      equal(requests.length, 3)
      equal(
        requests[2].items.slice(0, requests[1].items.length + 1),
        [...requests[1].items, { kind: 'assistant', text: 'held reply' }],
      )
      let entries = await a.transcript(s)
      equal(entries.filter((b) => b.result).length, 1)
      equal(entries.filter((b) => b.interrupted).length, 0)
    } finally {
      tool.resolve('FINAL_DURING_ASK')
      reply.resolve({ id: 'held-2', model: 'held-model', items: [] })
      await a.close()
    }
  },
)

const stoppedHost = await harness()

await observed(
  'stopping a session retains a running tool final without asking the model again',
  async ({ equal, ok }) => {
    let tool = deferred<string>()
    let requests = 0
    let runs = 0
    let a = agent({
      h: stoppedHost,
      name: 'stop-model',
      tools: [{
        name: 'stop-tool',
        description: 'Deferred tool',
        parameters: { type: 'object' },
        run: () => {
          runs++
          return tool.promise
        },
      }],
      model: (req) =>
        Promise.resolve({
          id: `stop-${++requests}`,
          model: req.model,
          items: requests == 1
            ? [{ kind: 'call', id: 'stop-call', name: 'stop-tool', args: '{}' }]
            : [{ kind: 'assistant', text: 'working' }],
        }),
    })
    try {
      let s = await a.start('start then stop')
      await until(async () =>
        runs == 1 && (await a.transcript(s)).some((b) => body(b) == 'working')
      )
      await stoppedHost.g.apply([{
        entity: { eid: 'async-test-stop' },
        entry: { session: s },
        stop: {},
      }])
      let asks = requests
      tool.resolve('FINAL_AFTER_STOP')
      await until(async () => (await a.transcript(s)).some((b) => b.result))
      await stoppedHost.fx.idle()
      let entries = await a.transcript(s)
      equal(statusOf(entries), 'stopped')
      equal(entries.filter((b) => b.result).length, 1)
      ok(entries.some((b) => body(b) == 'FINAL_AFTER_STOP'))
      equal(requests, asks)
      equal(runs, 1)
    } finally {
      tool.resolve('FINAL_AFTER_STOP')
      await a.close()
    }
  },
)

const recoveredHost = await harness()

await observed(
  'a durable async call recovers a crashed execution without replay and ignores redelivery',
  async ({ equal, ok }) => {
    let runs = 0
    let recovers = 0
    let asks = 0
    let tools = [{
      name: 'recover-tool',
      description: 'Tool with a durable external receipt',
      parameters: { type: 'object' },
      run: () => {
        runs++
        return 'SHOULD_NOT_REPLAY'
      },
      recover: () => {
        recovers++
        return 'RECOVERED_FINAL'
      },
    }]
    let opts = {
      h: recoveredHost,
      name: 'recovery-model',
      tools,
      model: ((req) =>
        Promise.resolve({
          id: `recovery-${++asks}`,
          model: req.model,
          items: asks == 1
            ? [{
              kind: 'call',
              id: 'recover',
              name: 'recover-tool',
              args: '{}',
            }]
            : [{ kind: 'assistant', text: 'recovered' }],
        })) as Model,
    }
    // Produce a real native call with its progress and durable effect, but no
    // worker yet. The crash boundary is after execution was recorded, before a
    // result reached the graph: recovery must inspect, never invoke run again.
    let declared = await recoveredHost.g.apply(
      seed({ model: opts.name, tools }),
      { trusted: true },
    )
    let model = declared.find((b) => b.model)!.entity.eid
    let provider = declared.find((b) => b.provider)!.entity.eid
    let s = 'async-recovery-session'
    await recoveredHost.g.apply([{
      entity: { eid: s },
      session: {},
    }, {
      entity: { eid: 'async-recovery-input' },
      entry: { session: s },
      using: { model, provider },
      content: { body: 'recover a prior execution' },
    }], { trusted: true })
    await react(recoveredHost.g, s, lend(opts))
    let [call] = await recoveredHost.g.read(`.entry.session=${s}&.call&*`)
    ok(call?.tool_async)
    await recoveredHost.g.apply([{
      entity: { eid: 'async-crashed-worker' },
      exit: { code: 1 },
    }, {
      entity: call.entity,
      execution: { by: 'async-crashed-worker' },
    }], { trusted: true })
    let a = agent(opts)
    try {
      await until(async () => (await a.transcript(s)).some((b) => b.result))
      await until(async () => statusOf(await a.transcript(s)) == 'settled')
      equal({ runs, recovers }, { runs: 0, recovers: 1 })
      let runner = {
        ...lend(opts),
        asyncTools: false,
        runCall: call.entity.eid,
      }
      await react(recoveredHost.g, s, runner)
      await react(recoveredHost.g, s, runner)
      let entries = await a.transcript(s)
      equal(entries.filter((b) => b.result).length, 1)
      ok(entries.some((b) => body(b) == 'RECOVERED_FINAL'))
      equal({ runs, recovers }, { runs: 0, recovers: 1 })
    } finally {
      await a.close()
    }
  },
)
