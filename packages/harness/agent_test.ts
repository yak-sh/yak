// The runner lent a graph and nothing else: no shell, no checkout, no lock, no
// instruction files, no file of its own. What a Worker lends the agent is this
// much (D1 is the same SQL), and a transcript still runs to the end.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Comp, identityEid } from '@yaks/graph'
import { type Model, ModelError } from '@yaks/model'
import { listing, OPENAI } from '@yaks/openai'
import { statusOf } from '@yaks/session'
import { agent } from './agent.ts'
import { harness } from './testing.ts'

let echo: Model = (req) =>
  Promise.resolve({
    id: 'r1',
    model: req.model,
    items: [{ kind: 'assistant', text: 'heard' }],
  })

let host = async () => {
  let { g, fx, vocab, me, close } = await harness()
  return { h: { g, fx, vocab, me }, release: close }
}

test('the runner needs a graph and a model, nothing of a machine', async () => {
  let { h, release } = await host()
  let released = false
  let a = agent({
    h,
    model: echo,
    release: () => {
      released = true
      release()
    },
  })
  let s = await a.start('ping')
  await a.idle(s)
  let entries = await a.transcript(s)
  assertEquals(statusOf(entries), 'settled')
  assertEquals(a.line(entries[0]).includes('ping'), true)
  await a.close()
  assertEquals(released, true)
  await assertRejects(() => a.send(s, 'again'), Error, 'Agent is closing')
})

test('what a caller says is signed with them, through the transcript', async () => {
  let { h, release } = await host()
  let a = agent({ h, model: echo, release })
  try {
    let [caller] = await h.g.apply([
      { entity: { eid: '$c' }, session: { id: 'caller' } },
    ])
    let by = caller.entity.eid
    let s = await a.start('ping', { by })
    await a.idle(s)
    await a.send(s, 'again', by)
    await a.idle(s)
    let said = (await a.transcript(s)).filter((b) => b.content && !b.output)
    assertEquals(
      said.map((b) => [(b.created as Comp).by, (b.created as Comp).via]),
      [[by, s], [by, s]],
    )
  } finally {
    await a.close()
  }
})

test('a new session opens with what its host found for it', async () => {
  let a = agent({
    ...await host(),
    model: echo,
    opening: () =>
      Promise.resolve({
        home: { cwd: '/work' },
        files: [{ body: 'be brief', source: '/work/AGENTS.md', revision: 'r' }],
      }),
  })
  let s = await a.start('ping')
  await a.idle(s)
  let [prompt, first] = await a.transcript(s)
  assertEquals(prompt.prompt, {
    scope: 'shared',
    source: '/work/AGENTS.md',
    revision: 'r',
  })
  assertEquals(first.content, { body: 'ping' })
  assertEquals(((await a.h.g.read('.session&*'))[0].home as Comp).cwd, '/work')
  await a.close(new Error('gone'))
  await assertRejects(() => a.start('pong'), Error, 'gone')
})

// Run independent real native sessions before registering outcome assertions.
// Each scenario owns and closes its host; tests only read immutable snapshots.
let nativeDiscovery = await (async () => {
  let outcomes = []
  for (let outage of [1, Infinity]) {
    let { h, release } = await host()
    let calls = 0
    let pauses: number[] = []
    let reports: { error: unknown; phase: string }[] = []
    let fake: Model = (req) => echo(req)
    fake.list = () =>
      listing(
        { token: 'secret', base: OPENAI },
        () => {
          calls++
          return Promise.resolve(
            calls <= outage
              ? new Response('', {
                status: 429,
                headers: { 'Retry-After': '2' },
              })
              : Response.json({ data: [{ id: 'metadata-model' }] }),
          )
        },
        undefined,
        {},
        {
          pause: (ms) => {
            pauses.push(ms)
            return Promise.resolve()
          },
        },
      )
    let a = agent({
      h,
      model: fake,
      name: 'metadata-model',
      report: (error, where) => reports.push({ error, phase: where.phase }),
    })
    try {
      // Only an unconfirmed model needs discovery. Confirmed models lacking
      // prices used to list on every turn, including all resumed sessions.
      await h.g.apply([{
        entity: { eid: identityEid('model', ['metadata-model']) },
        pending: {},
      }])
      let sessions = await Promise.all(
        Array.from({ length: 5 }, () => a.start('ping')),
      )
      await Promise.all(sessions.map((s) => a.idle(s)))
      let statuses = await Promise.all(
        sessions.map(async (s) => statusOf(await a.transcript(s))),
      )
      let firstCalls = calls
      let firstPauses = Object.freeze([...pauses])
      let phases = Object.freeze(reports.map((r) => r.phase))
      let retryable = reports.length
        ? reports[0].error instanceof ModelError
        : undefined
      await Promise.all(sessions.map((s) => a.send(s, 'again')))
      await Promise.all(sessions.map((s) => a.idle(s)))
      outcomes.push(Object.freeze({
        statuses: Object.freeze(statuses),
        firstCalls,
        pauses: firstPauses,
        phases,
        retryable,
        followupCalls: calls,
        followupStatuses: Object.freeze(
          await Promise.all(
            sessions.map(async (s) => statusOf(await a.transcript(s))),
          ),
        ),
      }))
    } finally {
      await a.close()
      release()
    }
  }
  return Object.freeze(outcomes)
})()

test('native metadata listing retries 429 then 200 before concurrent turns settle', () => {
  assertEquals(nativeDiscovery[0].statuses, Array(5).fill('settled'))
  assertEquals(nativeDiscovery[0].firstCalls, 2)
  assertEquals(nativeDiscovery[0].pauses, [2000])
  assertEquals(nativeDiscovery[0].phases, [])
})

test('native metadata exhaustion reaches its reporter without failing concurrent turns', () => {
  assertEquals(nativeDiscovery[1].statuses, Array(5).fill('settled'))
  assertEquals(nativeDiscovery[1].firstCalls, 3)
  assertEquals(nativeDiscovery[1].pauses, [2000, 4000])
  assertEquals(nativeDiscovery[1].phases, ['model-metadata'])
  assertEquals(nativeDiscovery[1].retryable, true)
})

test('native followup turns do not rediscover successful or exhausted metadata', () => {
  for (let outcome of nativeDiscovery) {
    assertEquals(outcome.followupCalls, outcome.firstCalls)
    assertEquals(outcome.followupStatuses, Array(5).fill('settled'))
  }
})
