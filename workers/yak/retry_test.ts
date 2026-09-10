// Retry the public callers, not just the helper: stubs consume POST bodies
// before failing, and each new stub permits only one call.
import { assertEquals, assertNotStrictEquals, assertRejects } from '@std/assert'
import { joining, posting, SPACE, wiped } from './build.ts'
import type { Space } from './directory.ts'
import type { Namespace } from './door.ts'
import type { Env } from './env.ts'
import { platform } from './harness.ts'
import { type Box, boxOf, destroyed, named, type Sandboxes } from './sandbox.ts'
import { listen, rostered, told } from './stream.ts'

let space: Space = {
  eid: 'space-eid',
  slug: 'ada',
  title: 'Ada',
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
}
let who = { person: 'person-eid', role: 'owner' as const }
let flagged = () => Object.assign(new Error('reset'), { retryable: true })
let failures = [
  flagged,
  () => new Error('Durable Object instance is no longer active'),
  () => new Error('Durable Object reset because its code was updated'),
]
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

for (let caller of callers) {
  Deno.test(
    caller.path + ': fresh stub and request, one eviction retry only',
    async () => {
      for (let failure of failures) {
        // Success, retry exhausted, and an unrelated error that must not retry.
        for (
          let errors of [[failure()], [failure(), failure()], [
            new Error('bad'),
          ]]
        ) {
          let gets = 0
          let seen: Request[] = []
          let ns: Namespace = {
            idFromName: (name) => {
              assertEquals(
                name,
                caller.binding == 'BUILDER' ? space.eid : who.person,
              )
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
          let { env } = platform('test', { [caller.binding]: ns })
          if (errors.length == 2 || errors[0].message == 'bad') {
            assertEquals(
              await assertRejects(() => caller.run(env)),
              errors.at(-1),
            )
          } else {
            await caller.run(env)
          }
          assertEquals(gets, errors[0].message == 'bad' ? 1 : 2)
          assertEquals(seen.length, gets)
          if (gets == 2) assertNotStrictEquals(seen[0], seen[1])
        }
      }
    },
  )
}

let methods: Array<{ method: keyof Box; args: unknown[]; result: unknown }> = [
  {
    method: 'exec',
    args: ['pwd', { cwd: '/app', env: { TEST: 'value' } }],
    result: { stdout: '/app', stderr: '', exitCode: 0 },
  },
  {
    method: 'writeFile',
    args: ['/app/a', 'café', { encoding: 'utf8' }],
    result: 'written',
  },
  {
    method: 'readFile',
    args: ['/app/a', { encoding: 'utf8' }],
    result: { content: 'café' },
  },
  { method: 'destroy', args: [], result: 'destroyed' },
  { method: 'setSleepAfter', args: ['5m'], result: 'set' },
]

for (let { method, args, result } of methods) {
  Deno.test(
    'sandbox ' + method + ': fresh stub, intact arguments, bounded retry',
    async () => {
      for (let failure of failures) {
        for (
          let errors of [[failure()], [failure(), failure()], [
            new Error('bad'),
          ]]
        ) {
          let gets = 0
          let calls = 0
          let ns: Sandboxes = {
            idFromName: (name) => {
              assertEquals(name, named(space))
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
          let env = { SANDBOX: ns }
          let box = boxOf(env, space, who.person, { since: Date.now() })
          assertEquals(gets, 0, 'take the stub per invocation, not per box')
          let call = () =>
            (box[method] as (...args: unknown[]) => Promise<unknown>)(...args)
          if (errors.length == 2 || errors[0].message == 'bad') {
            assertEquals(await assertRejects(call), errors.at(-1))
          } else {
            assertEquals(await call(), result)
          }
          assertEquals(gets, errors[0].message == 'bad' ? 1 : 2)
          assertEquals(calls, gets)
        }
      }
    },
  )
}

Deno.test('sandbox cleanup and initial sleep also retry evictions', async () => {
  let sleep = 0
  let destroy = 0
  let ns: Sandboxes = {
    idFromName: (name) => name,
    get: () => ({
      setSleepAfter: () =>
        ++sleep == 1 ? Promise.reject(flagged()) : Promise.resolve(),
      destroy: () =>
        ++destroy == 1 ? Promise.reject(flagged()) : Promise.resolve(),
    } as unknown as Box),
  }
  boxOf({ SANDBOX: ns }, space, who.person, { since: null })
  assertEquals(await destroyed({ SANDBOX: ns }, space), true)
  assertEquals(sleep, 2)
  assertEquals(destroy, 2)
})
