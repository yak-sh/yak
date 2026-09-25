// A failed Workers Build is filed with its commit; nothing else is filed. A
// commit's first failure is built once more, and nothing else is.
import { assertEquals, assertInstanceOf } from '@std/assert'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { broke, BuildFailed, builds, type Built, rebuild } from './builds.ts'
import type { Env } from './env.ts'
import { type Door, PLATFORM_STORE } from './door.ts'
import { Store } from './graph.ts'
import { metaOf } from './meta.ts'

let event = (type: string): Built => ({
  type: `cf.workersBuilds.worker.build.${type}`,
  source: { workerName: 'yak' },
  payload: {
    buildUuid: 'build-1',
    buildTriggerMetadata: {
      branch: 'main',
      commitHash: '191f7134aa',
      commitMessage: '@yaks/mail pulls what arrived',
    },
  },
})

Deno.test('builds: a failure is filed under its build, with its commit', () => {
  let b = broke(event('failed'))!
  assertEquals(b.build, 'build-1')
  assertEquals(b.request, 'BUILD yak 191f7134')
  assertEquals(b.tags, { worker: 'yak', commit: '191f7134aa', branch: 'main' })
  assertInstanceOf(b.error, BuildFailed)
  assertEquals(
    b.error.message,
    'the Workers Build of yak at 191f7134 (main) failed, so it never ' +
      'deployed: @yaks/mail pulls what arrived',
  )
})

Deno.test('builds: any other event is nothing to file', () => {
  for (let type of ['started', 'succeeded', 'canceled']) {
    assertEquals(broke(event(type)), null)
  }
})

Deno.test('builds: a failed build of a branch that deploys nothing is not filed', () => {
  let branch = event('failed')
  branch.payload!.buildTriggerMetadata!.branch = 'worktree-agent-1'
  assertEquals(broke(branch), null)
})

// The meta store, a Store object at the platform's own address.
let meta = () => {
  let store = new Store({
    storage: durable(),
    acceptWebSocket: () => {},
    getWebSockets: () => [] as Wire[],
  })
  let door: Door = (path, init = {}, headers = {}) => {
    let req = new Request(`http://store${path}`, init)
    for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
    req.headers.set('x-store', PLATFORM_STORE)
    return Promise.resolve(store.fetch(req))
  }
  return metaOf(door)
}

// The builds the deploy hook is asked for, when the queue hands these events
// over, in these batches, to one Worker.
let rebuilt = async (...batches: Built[][]) => {
  let env = { META: meta(), BUILD_HOOK: 'https://hook.test/main' } as Env
  let asked = 0
  let fetch = globalThis.fetch
  globalThis.fetch = () => (asked++, Promise.resolve(new Response('{}')))
  try {
    for (let batch of batches) {
      await builds({ messages: batch.map((body) => ({ body, ack() {} })) }, env)
    }
  } finally {
    globalThis.fetch = fetch
  }
  return asked
}

// What the deploy hook's own build says when it fails: main, and no commit.
let hooked = () => {
  let e = event('failed')
  e.payload!.buildUuid = 'build-2'
  e.payload!.buildTriggerMetadata!.commitHash = ''
  return e
}

Deno.test('builds: a commit that failed is built again, once', async () => {
  assertEquals(await rebuilt([event('failed')]), 1)
  // The queue delivering the same failure again, in one batch or the next.
  assertEquals(await rebuilt([event('failed'), event('failed')]), 1)
  assertEquals(await rebuilt([event('failed')], [event('failed')]), 1)
})

Deno.test('builds: a build with no commit is never built again', async () => {
  assertEquals(broke(hooked())!.commit, undefined)
  assertEquals(broke(hooked())!.request, 'BUILD yak unknown')
  assertEquals(await rebuilt([hooked()], [hooked()]), 0)
})

Deno.test('builds: with no hook there is nothing to start', async () => {
  assertEquals(await rebuild({} as Env), 'no BUILD_HOOK')
})
