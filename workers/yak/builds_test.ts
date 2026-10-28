// A failed Workers Build of main is filed with its commit, unless it is its
// commit's first failure and the build of it again started: then it is only
// logged. Nothing else is filed or built again.
import { clock, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { within } from './defects.ts'
import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
} from '@std/assert'
import {
  broke,
  BuildFailed,
  builds,
  type Built,
  diagnosed,
  failure,
  rebuild,
} from './builds.ts'
import type { Env } from './env.ts'
import type { Meta } from './meta.ts'

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
    'the Workers Build of yak at 191f7134 (main) failed: ' +
      '@yaks/mail pulls what arrived',
  )
})

let logPages = [
  Response.json({
    success: true,
    result: {
      cursor: 'next-page',
      truncated: true,
      lines: [[1, '--- deno task check']],
    },
  }),
  Response.json({
    success: true,
    result: { lines: [[2, 'error: TS2322 at sk-proj-private-value']] },
  }),
]
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
    return Promise.resolve(logPages[urls.length - 1])
  }
  try {
    let report = await diagnosed(env, broke(event('failed'))!)
    assertEquals(urls, [
      'https://cloudflare.test/accounts/account/builds/builds/build-1/logs',
      'https://cloudflare.test/accounts/account/builds/builds/build-1/logs?cursor=next-page',
    ])
    assertStringIncludes(
      report.error.message,
      'Step: deno task check; error: TS2322 at [redacted]; ' +
        'production did not deploy',
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

test('builds: the error names its statement, place and code', () => {
  let log = [
    'Executing user deploy command: deno task deploy:yak',
    'Task deploy:yak deno run -A workers/yak/wrangler.ts deploy',
    '✘ [ERROR] A request to the Cloudflare API (/accounts/0f9613dfd3f0451df0bd0f12a1372ea3/workers/scripts/yak) failed.',
    '',
    '  Uncaught TypeError: Invalid URL string.',
    '    at null.<anonymous> (file:///opt/buildhome/repo/packages/tracker/report.ts:103:12)',
    '    at init_report (index.js:1:298)',
    '   [code: 10021]',
    'Failed: error occurred while running deploy command',
  ]
  assertEquals(failure(log), {
    step: 'deploy yak',
    reason: 'Uncaught TypeError: Invalid URL string at ' +
      'packages/tracker/report.ts:103 [code 10021]',
  })
  assertEquals(failure(['--- deno task test', 'error: Test failed']), {
    step: 'deno task test',
    reason: 'Test failed',
  })
  assertEquals(
    failure(['ENOSPC: no space left on device']).reason,
    'disk full',
  )
  assertEquals(failure(['Retrying after timeout']).reason, 'timeout')
  assertEquals(
    failure([
      'Cloning repository...',
      'Failed: error occurred while fetching repository',
    ]),
    { step: 'Workers Builds setup', reason: 'repository fetch failed' },
  )
})

test('builds: a build that fails at staging says production deployed', async () => {
  let env = { CF_ACCOUNT: 'account', BUILD_LOG_TOKEN: 'test-token' } as Env
  let was = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(Response.json({
      success: true,
      result: {
        lines: [
          [1, 'Task deploy:yak deno run -A workers/yak/wrangler.ts deploy'],
          [2, 'Task deploy:yak-staging deno run -A workers/yak/wrangler.ts'],
          [3, '✘ [ERROR] A request to the Cloudflare API failed.'],
        ],
      },
    }))
  try {
    let report = await diagnosed(env, broke(event('failed'))!)
    assertStringIncludes(
      report.error.message,
      'Step: deploy staging; error: A request to the Cloudflare API failed; ' +
        'production deployed; staging did not',
    )
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
    assertEquals(report.error.message.includes('deploy'), false)
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

// The meta store's receipts, as its conditional write answers them (meta.ts
// `written`): an entity's second note finds its first and is Stale.
let receipts = (): Meta => {
  let held = new Set<string>()
  return {
    query: () => Promise.resolve([]),
    apply: (bundles) => {
      for (let { entity } of bundles) {
        let eid = String(entity?.eid)
        if (held.has(eid)) {
          return Promise.reject(new Stale(eid, 'failed', 'at', 'noted'))
        }
        held.add(eid)
      }
      return Promise.resolve(bundles)
    },
  }
}

// What one Worker comes to when the queue hands it these events in these
// batches: the builds the deploy hook is asked for, the failures filed, and
// the lines logged. The hook answers `hook`, or is not configured.
let consumed = async (batches: Built[][], hook: number | null = 200) => {
  let rows: Bundle[] = []
  let env = {
    META: receipts(),
    ...hook == null ? {} : { BUILD_HOOK: 'https://hook.test/main' },
    ERRORS: {
      send: (sent: Bundle[]) => {
        rows.push(...sent)
        return Promise.resolve()
      },
    },
  } as Env
  let time = clock()
  let asked = 0
  let logged = 0
  let [fetch, log] = [globalThis.fetch, console.log]
  globalThis.fetch = () => (
    asked++, Promise.resolve(new Response('{}', { status: hook ?? 500 }))
  )
  console.log = () => void logged++
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
    console.log = log
  }
  let filed =
    rows.filter((r) =>
      (r.exception as { type?: string } | undefined)?.type == 'BuildFailed'
    ).length
  return { asked, filed, logged }
}

// What the deploy hook's own build says when it fails: main, and no commit.
let hooked = () => {
  let e = event('failed')
  e.payload!.buildUuid = 'build-2'
  e.payload!.buildTriggerMetadata!.commitHash = ''
  return e
}

test('builds: a first failure whose rebuild started is a log line', async () => {
  let quiet = { asked: 1, filed: 0, logged: 1 }
  assertEquals(await consumed([[event('failed')]]), quiet)
  // The queue delivering the same failure again, in one batch or the next.
  assertEquals(await consumed([[event('failed'), event('failed')]]), quiet)
  assertEquals(await consumed([[event('failed')], [event('failed')]]), quiet)
})

test("builds: the rebuild's failure is filed", async () => {
  assertEquals(
    await consumed([[event('failed')], [hooked()]]),
    { asked: 1, filed: 1, logged: 1 },
  )
})

test('builds: a failure that earns no rebuild is filed', async () => {
  let filed = { asked: 0, filed: 1, logged: 0 }
  assertEquals(await consumed([[event('failed')]], null), filed)
  assertEquals(await consumed([[event('failed')]], 404), { ...filed, asked: 1 })
  // The commit's second build, after its first earned the rebuild.
  let again = event('failed')
  again.payload!.buildUuid = 'build-3'
  assertEquals(
    await consumed([[event('failed'), again]]),
    { asked: 1, filed: 1, logged: 1 },
  )
})

test('builds: a build with no commit is never built again', async () => {
  assertEquals(broke(hooked())!.commit, undefined)
  assertEquals(broke(hooked())!.request, 'BUILD yak unknown')
  assertEquals(
    await consumed([[hooked()], [hooked()]]),
    { asked: 0, filed: 1, logged: 0 },
  )
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

// What these builds are filed under, each log ending in its line: the cause
// the tracker keeps one bug for, and the commit that was built.
let diagnoses = async (logs: Record<string, string>) => {
  let env = {
    CF_ACCOUNT: 'account',
    BUILD_LOG_TOKEN: 'token',
    WORKERS_API: 'https://cloudflare.test',
  } as Env
  let fetch = globalThis.fetch
  globalThis.fetch = (input) => {
    let uuid = String(input).match(/builds\/builds\/([^/]+)\/logs/)?.[1]
    return Promise.resolve(Response.json({
      success: true,
      result: { lines: [[1, '--- deno task check'], [2, logs[uuid!] ?? '']] },
    }))
  }
  try {
    return await Promise.all(
      Object.keys(logs).map(async (uuid, i) => {
        let e = event('failed')
        e.payload!.buildUuid = uuid
        e.payload!.buildTriggerMetadata!.commitHash = `c${i}`
        let b = await diagnosed(env, broke(e)!)
        return [b.cause, b.commit]
      }),
    )
  } finally {
    globalThis.fetch = fetch
  }
}

test('builds: failures of one cause are one bug, each under the commit it built', async () => {
  let [first, second, third] = await diagnoses({
    'build-1': 'error: TS2322 in report.ts:103',
    'build-2': 'error: TS2322 in report.ts:105',
    'build-3': 'the upload timed out',
  })
  assertEquals(first[0], second[0])
  assertEquals(first[0] == third[0], false)
  assertEquals([first[1], second[1], third[1]], ['c0', 'c1', 'c2'])
})
