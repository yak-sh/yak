// Retry the public callers, not just the helper: stubs consume POST bodies
// before failing, and each new stub permits only one call.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { WALKED, WALKTHROUGH, wiped } from './build-door.ts'
import type { Space } from './directory.ts'
import { space as spaceOf } from './directory-fixture.ts'
import type { Namespace } from '@yaks/durable-object/door'
import type { Env } from './env.ts'
import { platform, sandboxes } from './testing.ts'
import { destroyed, workbench } from './sandbox.ts'
import {
  type Box,
  cloudflareProvider,
  named,
  type Sandboxes,
} from '@yaks/sandbox/cloudflare'
import { backoff, evicted, retried } from '@yaks/durable-object'
import { listen, rostered, said, told } from './stream.ts'
import { asked } from './walkthrough.ts'
import { fetchOf } from './door.ts'
import { namespace } from '../../packages/durable-object/testing.ts'

let space: Space = spaceOf({
  eid: 'space-eid',
  slug: 'ada',
  store: 'ada',
  title: 'Ada',
  tier: null,
})
let who = { person: 'person-eid', role: 'owner' as const }
let flagged = () => Object.assign(new Error('reset'), { retryable: true })
let failures = [
  flagged,
  () => new Error('Durable Object instance is no longer active'),
  () => new Error('Durable Object reset because its code was updated'),
  () => new Error('Durable Object reset because a newer deploy reached it: b'),
]
// Each failure once and up to every pause running, then an unrelated error
// that must not retry. A call fails when every send it made failed.
let runs = (failure: () => Error) => [
  ...backoff.pauses.map((_, n) => Array.from({ length: n + 1 }, failure)),
  [failure(), ...backoff.pauses.map(failure)],
  [new Error('bad')],
]
let sends = (errors: Error[]) =>
  errors[0].message == 'bad'
    ? 1
    : Math.min(errors.length + 1, backoff.pauses.length + 1)
// The pauses between sends are recorded here, never slept.
let paused: number[] = []
let pause = (ms: number) => Promise.resolve(void paused.push(ms))
// The env's clock, which a caller's resend waits out its pause on, and a call
// run with it moved on until the call settles.
let time = clock()
let settled = async <T>(call: Promise<T>) => {
  let done = false
  call.then(() => done = true, () => done = true)
  while (!done) await time.advance(backoff.pauses[0])
  return call
}
let fails = (errors: Error[]) => sends(errors) == errors.length
let callers: Array<{
  path: string
  binding: 'BUILDER' | 'WIRE'
  body: string
  headers: Record<string, string>
  run: (env: Env) => Promise<unknown>
}> = [
  {
    path: 'http://builder/wipe',
    binding: 'BUILDER',
    body: '',
    headers: { 'x-yak-kernel': '1' },
    run: (env) => wiped(env, space.eid),
  },
  {
    path: 'http://wire/open',
    binding: 'WIRE',
    body: '',
    headers: { 'mcp-session-id': 'session', 'last-event-id': '42' },
    run: (env) =>
      listen(
        env,
        who.person,
        new Request('https://yaks.app/mcp', {
          headers: { 'mcp-session-id': 'session', 'last-event-id': '42' },
        }),
      ),
  },
  {
    path: 'http://wire/roster',
    binding: 'WIRE',
    body: JSON.stringify({
      session: 'session',
      version: 'v1',
      names: ['tool'],
    }),
    headers: {},
    run: async (env) =>
      assertEquals(
        (await rostered(env, who.person, {
          session: 'session',
          version: 'v1',
          names: ['tool'],
        })).line,
        'changed',
      ),
  },
  {
    path: 'http://wire/said',
    binding: 'WIRE',
    body: JSON.stringify({ session: 'session', version: 'v1', names: [] }),
    headers: {},
    run: (env) =>
      said(env, who.person, { session: 'session', version: 'v1', names: [] }),
  },
  {
    path: 'http://wire/tell',
    binding: 'WIRE',
    body: JSON.stringify({ method: 'news', params: { text: 'café' } }),
    headers: {},
    run: (env) => told(env, who.person, 'news', { text: 'café' }),
  },
]

// Which failures are retried, and how often, is `retried`'s. Each caller below
// is sent one eviction, for what it makes of the sends: a fresh stub and a
// request built again each time.
// A call through `retried` failing with `errors` in turn: what it answers,
// how many sends it made, and the pauses between them.
let retrying = async (errors: Error[]) => {
  let sent = 0
  paused.length = 0
  let call = () =>
    retried(
      () => {
        let error = errors[sent++]
        if (error) throw error
        return 'ok'
      },
      true,
      evicted,
      pause,
    )
  if (fails(errors)) {
    assertEquals(await assertRejects(call), errors.at(-1))
  } else assertEquals(await call(), 'ok')
  assertEquals(sent, sends(errors))
  assertEquals(paused, backoff.pauses.slice(0, sent - 1))
}

// Every eviction is one `retried` sends again; the pauses, which take no
// account of which it was, are spent through one of them.
test('retried: every eviction is sent again after a pause, once per pause', async () => {
  for (let failure of failures) await retrying([failure()])
  for (let errors of runs(flagged)) await retrying(errors)
})

let deployed = () =>
  Object.assign(
    new Error('Durable Object reset because a newer deploy reached it: b'),
    { durableObjectReset: true, remote: true },
  )
let interrupted = () =>
  new Response(
    new ReadableStream({
      start(out) {
        out.enqueue(new TextEncoder().encode('{"partial":'))
        out.error(deployed())
      },
    }),
  )

test('walkthrough POST reads receive their whole answer across a deploy reset', async () => {
  for (let path of [WALKTHROUGH, WALKED]) {
    for (
      let failure of [
        deployed(),
        interrupted(),
        Response.json({
          message: deployed().message,
        }, { status: 500 }),
      ]
    ) {
      let ns = namespace([failure, Response.json({ kept: true })])
      let { env } = platform('test', { CLOCK: time, BUILDER: ns })
      assertEquals(
        await settled(asked(env, space.eid, path, { app: 'club', step: 0 })),
        { kept: true },
      )
      assertEquals(ns.sent.map((s) => s.body), [
        '{"app":"club","step":0}',
        '{"app":"club","step":0}',
      ])
      assertEquals(ns.gets.length, 2)
    }
  }
})

test('a POST without replay permission hands its interrupted answer on once', async () => {
  let ns = namespace([interrupted(), Response.json({ kept: true })])
  let fetch = fetchOf(ns, space.eid, pause)
  let answer = await fetch(() =>
    new Request('http://builder/say', { method: 'POST', body: 'say once' })
  )
  await assertRejects(() => answer.text(), Error, 'newer deploy')
  assertEquals(ns.sent.length, 1)
})

test('a write is sent again only when its object restarted for the deploy before serving it', async () => {
  let write = (failure: Error) => {
    let ns = namespace([failure, Response.json({ kept: true })])
    let sent = fetchOf(ns, space.eid, pause)(
      () => new Request('http://builder/graph', { method: 'POST', body: 'w' }),
      { replayable: false },
    )
    return { ns, sent }
  }
  let unserved = write(deployed())
  assertEquals(await (await unserved.sent).json(), { kept: true })
  assertEquals(unserved.ns.sent.map((s) => s.body), ['w', 'w'])
  let cut = write(
    new Error('Durable Object reset because its code was updated'),
  )
  await assertRejects(() => cut.sent, Error, 'code was updated')
  assertEquals(cut.ns.sent.length, 1)
})

test('an object event stream remains live rather than waiting for its whole body', async () => {
  let response = new Response(new ReadableStream({}), {
    headers: { 'content-type': 'text/event-stream' },
  })
  let ns = namespace([response])
  let answer = await fetchOf(ns, space.eid, pause)(() =>
    new Request('http://wire/open')
  )
  assertEquals(answer, response)
  await answer.body?.cancel()
})

for (let caller of callers) {
  // The env is taken once; each run swaps the namespace behind it.
  let current: Namespace
  let { env } = platform('test', {
    CLOCK: time,
    [caller.binding]: {
      idFromName: (name: string) => current.idFromName(name),
      get: (id: unknown) => current.get(id as never),
    },
  })
  test(caller.path + ': a fresh stub and request each send', async () => {
    let errors = [flagged()]
    let seen: Request[] = []
    let gets = 0
    current = {
      idFromName: (name) => {
        assertEquals(name, caller.binding == 'BUILDER' ? space.eid : who.person)
        return name
      },
      get: () => {
        gets++
        let calls = 0
        return {
          fetch: async (req) => {
            assertEquals(++calls, 1, 'never reuse a failed stub')
            seen.push(req)
            assertEquals(req.url, caller.path)
            assertEquals(await req.text(), caller.body)
            for (let [key, value] of Object.entries(caller.headers)) {
              assertEquals(req.headers.get(key), value)
            }
            let error = errors[seen.length - 1]
            if (error) throw error
            return Response.json({ frames: [], line: 'changed' })
          },
        }
      },
    }
    await settled(caller.run(env))
    assertEquals(gets, 2)
    assertEquals(new Set(seen).size, 2)
  })
}

let methods: Array<{ method: keyof Box; args: unknown[]; result: unknown }> = [
  {
    method: 'exec',
    args: ['pwd', { cwd: '/workspace', env: {} }],
    result: { stdout: '/app', stderr: '', exitCode: 0 },
  },
  {
    method: 'writeFile',
    args: ['a', 'café', undefined],
    result: 'written',
  },
  {
    method: 'readFile',
    args: ['/app/a', undefined],
    result: { content: 'café' },
  },
  { method: 'destroy', args: [], result: 'destroyed' },
]

for (let { method, args, result } of methods) {
  test(
    'sandbox ' + method + ': fresh stub, intact arguments, bounded retry',
    async () => {
      {
        for (let errors of runs(flagged)) {
          let gets = 0
          let calls = 0
          let ns: Sandboxes = {
            idFromName: (name) => {
              assertEquals(name, named(space.eid, who.person!))
              return name
            },
            get: () => {
              gets++
              let used = false
              return {
                [method]: (...received: unknown[]) => {
                  assertEquals(used, false)
                  used = true
                  assertEquals(received, args)
                  let error = errors[calls++]
                  // Exercise synchronous RPC failures as well as rejections.
                  if (error) throw error
                  return Promise.resolve(result)
                },
              } as unknown as Box
            },
          }
          let provider = cloudflareProvider(ns, {
            ephemeral: true,
            trash: async (_ref, box) => {
              await box.destroy()
            },
            retry: (send) => retried(send, true, evicted, pause),
          })
          let ref = { id: named(space.eid, who.person!) }
          let { workspace: machine } = await provider.connect(ref)
          assertEquals(gets, 0, 'take the stub per invocation, not per box')
          let call = () =>
            method == 'exec'
              ? provider.exec(ref, 'pwd')
              : method == 'writeFile'
              ? machine.write('a', 'café')
              : method == 'readFile'
              ? machine.read('/app/a')
              : method == 'destroy'
              ? provider.dispose(ref)
              : provider.request!(ref)
          if (fails(errors)) {
            assertEquals(await assertRejects(call), errors.at(-1))
          } else {
            let answer = await call()
            if (method == 'exec') assertEquals(answer, result)
            if (method == 'readFile') assertEquals(answer, 'café')
          }
          assertEquals(gets, sends(errors))
          assertEquals(calls, gets)
        }
      }
    },
  )
}

test('sandbox cleanup and initial sleep also retry evictions', async () => {
  let sleep = 0
  let destroy = 0
  let box = sandboxes()
  let ns: Sandboxes = {
    idFromName: (name) => name,
    get: () => ({
      ...box.WORKBENCH.get(space.eid),
      setSleepAfter: () =>
        ++sleep == 1 ? Promise.reject(flagged()) : Promise.resolve(),
      destroy: () =>
        ++destroy == 1 ? Promise.reject(flagged()) : Promise.resolve(),
    }),
  }
  await settled(workbench(
    { WORKBENCH: ns, CLOCK: time },
    space,
    who.person,
    { since: null },
  ))
  assertEquals(
    await settled(
      destroyed({ WORKBENCH: ns, CLOCK: time }, space, who.person!),
    ),
    true,
  )
  assertEquals(sleep, 2)
  assertEquals(destroy, 2)
})
