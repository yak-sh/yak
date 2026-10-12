// A failed Workers Build is filed with its commit; nothing else is filed. A
// commit's first failure is built once more, and nothing else is.
import { clock, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { within } from './defects.ts'
import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
} from '@std/assert'
import type { Wire } from '@yaks/durable-object'
import { durable } from './testing.ts'
import {
  broke,
  BuildFailed,
  builds,
  type Built,
  diagnosed,
  rebuild,
} from './builds.ts'
import type { Env } from './env.ts'
import { doorOf, PLATFORM_STORE } from './door.ts'
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

test('builds: a failure is filed under its build, with its commit', () => {
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

test('builds: report links to the failing build and summarizes its log safely', async () => {
  let env = {
    CF_ACCOUNT: 'account',
    BUILD_LOG_TOKEN: 'secret-build-token',
    WORKERS_API: 'https://cloudflare.test',
  } as Env
  let urls: string[] = []
  let was = globalThis.fetch
  globalThis.fetch = (input, init) => {
    let url = String(input)
    urls.push(url)
    assertEquals(
      new Headers(init?.headers).get('authorization'),
      'Bearer secret-build-token',
    )
    let first = urls.length == 1
    return Promise.resolve(Response.json({
      success: true,
      result: {
        cursor: first ? 'next-page' : undefined,
        truncated: first,
        lines: first
          ? [[1, '--- deno task check']]
          : [[2, 'error: TS2322 at sk-proj-private-value']],
      },
    }))
  }
  try {
    let report = await diagnosed(env, broke(event('failed'))!)
    assertEquals(urls, [
      'https://cloudflare.test/accounts/account/builds/builds/build-1/logs',
      'https://cloudflare.test/accounts/account/builds/builds/build-1/logs?cursor=next-page',
    ])
    assertStringIncludes(
      report.error.message,
      'Step: deno task check; error: TypeScript TS2322',
    )
    assertStringIncludes(
      report.error.message,
      'https://dash.cloudflare.com/account/workers/services/view/yak/production/builds/build-1',
    )
    assertEquals(report.error.message.includes('sk-proj-private-value'), false)
    assertEquals(report.error.message.includes('secret-build-token'), false)
  } finally {
    globalThis.fetch = was
  }
})

test('builds: a logs API failure keeps the build link in the report', async () => {
  let env = { CF_ACCOUNT: 'account', BUILD_LOG_TOKEN: 'test-token' } as Env
  let was = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new Response('', { status: 403 }))
  try {
    let report = await diagnosed(env, broke(event('failed'))!)
    assertStringIncludes(
      report.error.message,
      'Details unavailable: build logs returned HTTP 403',
    )
    assertStringIncludes(report.error.message, '/production/builds/build-1')
  } finally {
    globalThis.fetch = was
  }
})

test('builds: any other event is nothing to file', () => {
  for (let type of ['started', 'succeeded', 'canceled']) {
    assertEquals(broke(event(type)), null)
  }
})

test('builds: a failed build of a branch that deploys nothing is not filed', () => {
  let branch = event('failed')
  branch.payload!.buildTriggerMetadata!.branch = 'worktree-agent-1'
  assertEquals(broke(branch), null)
})

// The meta store, a Store object at the platform's own address.
let meta = () => {
  let store = new Store({
    storage: durable(PLATFORM_STORE),
    acceptWebSocket: () => {},
    getWebSockets: () => [] as Wire[],
  })
  let door = doorOf((req) => Promise.resolve(store.fetch(req)), PLATFORM_STORE)
  return metaOf(door)
}

// The builds the deploy hook is asked for, when the queue hands these events
// over, in these batches, to one Worker.
let rebuilt = async (...batches: Built[][]) => {
  let samples: Bundle[] = []
  let env = {
    META: meta(),
    BUILD_HOOK: 'https://hook.test/main',
    ERRORS: {
      send: (rows: Bundle[]) => {
        samples.push(...rows)
        return Promise.resolve()
      },
    },
  } as Env
  let time = clock()
  let asked = 0
  let fetch = globalThis.fetch
  globalThis.fetch = () => (asked++, Promise.resolve(new Response('{}')))
  try {
    await within(env, {}, async () => {
      for (let batch of batches) {
        await builds(
          { messages: batch.map((body) => ({ body, ack() {} })) },
          env,
        )
      }
    }, time)
    await time.advance(10_000)
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

test('builds: a commit that failed is built again, once', async () => {
  assertEquals(await rebuilt([event('failed')]), 1)
  // The queue delivering the same failure again, in one batch or the next.
  assertEquals(await rebuilt([event('failed'), event('failed')]), 1)
  assertEquals(await rebuilt([event('failed')], [event('failed')]), 1)
  let other = event('failed')
  other.payload!.buildUuid = 'build-2'
  assertEquals(await rebuilt([event('failed'), other]), 1)
})

test('builds: a build with no commit is never built again', async () => {
  assertEquals(broke(hooked())!.commit, undefined)
  assertEquals(broke(hooked())!.request, 'BUILD yak unknown')
  assertEquals(await rebuilt([hooked()], [hooked()]), 0)
})

test('builds: with no hook there is nothing to start', async () => {
  assertEquals(await rebuild({} as Env), 'no BUILD_HOOK')
})

test('builds: a failed hook request does not disclose its credential', async () => {
  let was = globalThis.fetch
  let sent: Bundle[] = []
  let env = {
    BUILD_HOOK: 'https://hook.test/secret',
    ERRORS: {
      send: (rows: Bundle[]) => {
        sent.push(...rows)
        return Promise.resolve()
      },
    },
  } as Env
  globalThis.fetch = () => Promise.reject(new Error('https://hook.test/secret'))
  try {
    assertEquals(
      await within(env, {}, () => rebuild(env), clock()),
      'failed to reach deploy hook',
    )
    assertEquals(sent.length, 1)
    assertEquals(
      JSON.stringify(sent).includes('https://hook.test/secret'),
      false,
    )
  } finally {
    globalThis.fetch = was
  }
})

// What the tracker hears when these builds fail, each log ending in its line.
let filed = async (logs: Record<string, string>) => {
  let samples: Bundle[] = []
  let env = {
    META: meta(),
    CF_ACCOUNT: 'account',
    BUILD_LOG_TOKEN: 'token',
    WORKERS_API: 'https://cloudflare.test',
    ERRORS: {
      send: (rows: Bundle[]) => (samples.push(...rows), Promise.resolve()),
    },
  } as Env
  let time = clock()
  let fetch = globalThis.fetch
  globalThis.fetch = (input) => {
    let uuid = String(input).match(/builds\/builds\/([^/]+)\/logs/)?.[1]
    return Promise.resolve(Response.json({
      success: true,
      result: { lines: [[1, '--- deno task check'], [2, logs[uuid!] ?? '']] },
    }))
  }
  let failed = (uuid: string, commit: string) => {
    let e = event('failed')
    e.payload!.buildUuid = uuid
    e.payload!.buildTriggerMetadata!.commitHash = commit
    return { body: e, ack() {} }
  }
  try {
    await within(env, {}, () =>
      builds({
        messages: Object.keys(logs).map((uuid, i) => failed(uuid, `c${i}`)),
      }, env), time)
    await time.advance(10_000)
  } finally {
    globalThis.fetch = fetch
  }
  return samples.map((row) => {
    let e = row.error as { fault: string; commit: string; hits?: number }
    return [e.fault, e.commit, e.hits ?? 1]
  })
}

test('builds: failures of one cause are one bug, each under the commit it built', async () => {
  let [first, second, third] = await filed({
    'build-1': 'error: TS2322 in report.ts:103',
    'build-2': 'error: TS2322 in report.ts:105',
    'build-3': 'the upload timed out',
  }).then((rows) =>
    rows.toSorted((a, b) => String(a[1]).localeCompare(String(b[1])))
  )
  assertEquals(first[0], second[0])
  assertEquals(first[0] == third[0], false)
  assertEquals([first[1], second[1], third[1]], ['c0', 'c1', 'c2'])
})
