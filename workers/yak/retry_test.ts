// Retry the public callers, not just the helper: stubs consume POST bodies
// before failing, and each new stub permits only one call.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { joining, posting, SPACE, wiped } from './build.ts'
import type { Space } from './directory.ts'
import type { Namespace } from './door.ts'
import type { Env } from './env.ts'
import { platform, sandboxes, workspaces } from './testing.ts'
import { destroyed, named, workbench } from './sandbox.ts'
import {
  type Box,
  cloudflareProvider,
  type Sandboxes,
} from '@yaks/sandbox/cloudflare'
import { backoff, retried } from '@yaks/durable-object'
import { listen, rostered, told } from './stream.ts'

let space: Space = {
  eid: 'space-eid',
  slug: 'ada',
  store: 'ada',
  title: 'Ada',
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
}
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
backoff.wait = (ms) => Promise.resolve(void paused.push(ms))
let fails = (errors: Error[]) => sends(errors) == errors.length
let upgrade = () =>
  new Request('https://ada.yaks.app/api/build', {
    headers: {
      Upgrade: 'websocket',
      [SPACE]: 'forged-space',
      'x-yak-person': 'forged-person',
      'x-yak-role': 'forged-role',
      'x-yak-kernel': '1',
    },
  })
let callers: Array<{
  path: string
  binding: 'BUILDER' | 'WIRE'
  body: string
  headers: Record<string, string>
  run: (env: Env) => Promise<unknown>
}> = [
  {
    path: 'http://builder/ws',
    binding: 'BUILDER',
    body: '',
    headers: {
      upgrade: 'websocket',
      [SPACE]: space.eid,
      'x-yak-person': who.person,
      'x-yak-role': who.role,
    },
    run: (env) => joining(env, space.eid, upgrade(), who),
  },
  {
    path: 'http://builder/wipe',
    binding: 'BUILDER',
    body: '',
    headers: { 'x-yak-kernel': '1' },
    run: (env) => wiped(env, space.eid),
  },
  {
    path: 'http://builder/say',
    binding: 'BUILDER',
    body: JSON.stringify({ say: 'Build a café' }),
    headers: { [SPACE]: space.eid, 'x-yak-person': who.person },
    run: (env) =>
      posting(
        env,
        space,
        new Request('https://ada.yaks.app/api/build', {
          method: 'POST',
          body: new URLSearchParams({ say: 'Build a café' }),
        }),
        who,
      ),
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
        await rostered(env, who.person, {
          session: 'session',
          version: 'v1',
          names: ['tool'],
        }),
        'changed',
      ),
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
    retried(() => {
      let error = errors[sent++]
      if (error) throw error
      return 'ok'
    })
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

for (let caller of callers) {
  // The env is taken once; each run swaps the namespace behind it.
  let current: Namespace
  let { env } = platform('test', {
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
            if (caller.path.endsWith('/ws')) {
              assertEquals(req.headers.has('x-yak-kernel'), false)
            }
            let error = errors[seen.length - 1]
            if (error) throw error
            return Response.json({ frames: [], line: 'changed' })
          },
        }
      },
    }
    await caller.run(env)
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
              assertEquals(name, named(space, who.person!))
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
            legacyRecreation: true,
            retry: retried,
          })
          let ref = { id: named(space, who.person!) }
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
      ...box.SANDBOX.get(space.eid),
      setSleepAfter: () =>
        ++sleep == 1 ? Promise.reject(flagged()) : Promise.resolve(),
      destroy: () =>
        ++destroy == 1 ? Promise.reject(flagged()) : Promise.resolve(),
    }),
  }
  await workbench(
    { SANDBOX: ns, WORKSPACES: workspaces(ns) },
    space,
    who.person,
    { since: null },
  )
  assertEquals(await destroyed({ SANDBOX: ns }, space, who.person!), true)
  assertEquals(sleep, 2)
  assertEquals(destroy, 2)
})
