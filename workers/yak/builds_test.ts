// A failed Workers Build of main is filed under its cause, naming its commit,
// unless it is its commit's first failure and the build of it again started:
// then it is only logged. Nothing else is filed or built again.
import { clock, test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
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

test('builds: a hook failure gets its checked-out commit from the log', async () => {
  let commit = 'a6aa52d9' + '1'.repeat(32)
  let hook = event('failed')
  hook.payload!.buildTriggerMetadata!.commitHash = ''
  let env = { CF_ACCOUNT: 'account', BUILD_LOG_TOKEN: 'test-token' } as Env
  let was = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(Response.json({
      success: true,
      result: {
        lines: [[1, `Build commit: ${commit}`], [2, 'error: missing module']],
      },
    }))
  try {
    let report = await diagnosed(env, broke(hook)!)
    assertEquals(report.commit, commit)
    assertEquals(report.tags.commit, commit)
    assertEquals(report.request, 'BUILD yak a6aa52d9')
    assertStringIncludes(report.error.message, 'at a6aa52d9')
    assertStringIncludes(report.error.message, 'error: missing module')
  } finally {
    globalThis.fetch = was
  }
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
// `written`): an entity's second receipt finds its first and is Stale. A
// `built` note is read back by its build.
let receipts = (): Meta => {
  let held = new Map<string, Bundle>()
  return {
    query: (line) => {
      let row = held.get(line.match(/eid=([^&]+)/)?.[1] ?? '')
      return Promise.resolve(row?.built ? [row] : [])
    },
    apply: (bundles) => {
      for (let bundle of bundles) {
        let eid = String(bundle.entity?.eid)
        if (bundle.$was && held.get(eid)?.failed) {
          return Promise.reject(new Stale(eid, 'failed', 'at', 'noted'))
        }
        held.set(eid, { ...held.get(eid), ...bundle })
      }
      return Promise.resolve(bundles)
    },
  }
}

// What one Worker comes to when the queue hands it these events in these
// batches: the builds the deploy hook is asked for, the failures filed, and
// the lines logged. The hook answers `hook`, or is not configured.
let consumed = async (
  batches: Built[][],
  hook: number | null = 200,
  answer: unknown = { success: true, result: { build_uuid: 'build-2' } },
) => {
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
    asked++, Promise.resolve(Response.json(answer, { status: hook ?? 500 }))
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

test('builds: a hook that defers to a pending build of main is a log line', async () => {
  let pending = { success: true, result: { already_exists: true } }
  assertEquals(
    await consumed([[event('failed')]], 200, pending),
    { asked: 1, filed: 0, logged: 1 },
  )
})

test('builds: a hook that answers 200 without success started nothing', async () => {
  assertEquals(
    await consumed([[event('failed')]], 200, { success: false }),
    { asked: 1, filed: 1, logged: 0 },
  )
})

test("builds: the rebuild's failure is filed under the commit it rebuilt", async () => {
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

test("builds: a hook build the kernel did not start is the catch-up's", async () => {
  assertEquals(broke(hooked())!.commit, undefined)
  assertEquals(broke(hooked())!.request, 'BUILD yak unknown')
  assertEquals(
    await consumed([[hooked()], [hooked()]]),
    { asked: 0, filed: 0, logged: 1 },
  )
})

test('builds: with no hook there is nothing to start', async () => {
  assertEquals(await rebuild({} as Env), {
    started: false,
    said: 'no BUILD_HOOK',
  })
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
      (await within(env, {}, () => rebuild(env), clock())).said,
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
        return [b.cause, b.commit, b.error.message]
      }),
    )
  } finally {
    globalThis.fetch = fetch
  }
}

test('builds: one cause across commits is one bug, naming each commit', async () => {
  let mkdtemp = 'error: Uncaught (in promise) Error: ENOENT: no such file or ' +
    "directory, mkdtemp '/opt/buildhome/repo/workers/yak/.wrangler/sibling-X'"
  let error = 'Uncaught (in promise) Error: ENOENT: no such file or ' +
    "directory, mkdtemp 'workers/yak/.wrangler/sibling-X'"
  let found = await diagnoses({
    'build-1': mkdtemp,
    'build-2': mkdtemp,
    'build-3': 'error: TS2322 in report.ts:105',
  })
  assertEquals(found.map(([cause]) => cause), [
    `deno task check: ${error}`,
    `deno task check: ${error}`,
    'deno task check: TS2322 in report.ts:105',
  ])
  found.forEach(([cause, commit, message]) => {
    assertStringIncludes(message!, `at ${commit} (main) failed`)
    assertStringIncludes(message!, cause!.replace('deno task check: ', ''))
  })
})

test('builds: the bundler diagnostic survives its wrapper errors', () => {
  assertEquals(
    failure([
      'Task deploy:yak deno run -A workers/yak/wrangler.ts deploy',
      '✘ [ERROR] Could not resolve "stemmer"',
      'error: Uncaught (in promise) Error: Build failed with 1 error:',
      'error: Uncaught (in promise) Error: Kernel modules generation failed',
    ]),
    { step: 'deploy yak', reason: 'Could not resolve "stemmer"' },
  )
})

test('builds: unread logs are one cause, each failure naming its commit', async () => {
  let env = { CF_ACCOUNT: 'account' } as Env
  let first = event('failed'), second = event('failed')
  second.payload!.buildTriggerMetadata!.commitHash = 'another-commit'
  let reports = await Promise.all(
    [first, second, hooked()].map((e) => diagnosed(env, broke(e)!)),
  )
  assertEquals(
    reports.map((r) => r.cause),
    Array(3).fill('log unread: BUILD_LOG_TOKEN unavailable'),
  )
  assertEquals(
    reports.map((r) => r.error.message.match(/ at (\S+) /)?.[1]),
    ['191f7134', 'another-', 'unknown'],
  )
})

// A push of one commit whose build fails, the kernel's rebuild of it
// (`build-2`) failing too, and the catch-up's build of main (`build-3`)
// failing after: what reaches the tracker, with the logs readable or not.
let reported = async (readable: boolean) => {
  let commit = '0b5802113' + '1'.repeat(31)
  let rows: Bundle[] = []
  let env = {
    CF_ACCOUNT: 'account',
    BUILD_LOG_TOKEN: 'build-token',
    WORKERS_API: 'https://cloudflare.test',
    BUILD_HOOK: 'https://hook.test/main',
    META: receipts(),
    ERRORS: {
      send: (sent: Bundle[]) => {
        rows.push(...sent)
        return Promise.resolve()
      },
    },
  } as Env
  let [fetch, log] = [globalThis.fetch, console.log]
  globalThis.fetch = (input) =>
    Promise.resolve(
      String(input).startsWith('https://hook.test')
        ? Response.json({ success: true, result: { build_uuid: 'build-2' } })
        : readable
        ? Response.json({
          success: true,
          result: { lines: [[1, 'error: missing module']] },
        })
        : new Response('', { status: 401 }),
    )
  console.log = () => {}
  let push = event('failed')
  push.payload!.buildTriggerMetadata!.commitHash = commit
  let catchup = hooked()
  catchup.payload!.buildUuid = 'build-3'
  let time = clock()
  try {
    await within(env, {}, async () => {
      for (let body of [push, hooked(), catchup]) {
        await builds({ messages: [{ body, ack() {} }] }, env)
      }
    }, time)
    await time.advance(10_000)
    return {
      rows: rows.filter((row) => row.error).map((row) => ({
        error: row.error as {
          fault: string
          commit: string
          tags: { commit: string }
        },
        message: String((row.exception as Comp).value),
      })),
      commit,
    }
  } finally {
    globalThis.fetch = fetch
    console.log = log
  }
}

test('builds: a rebuild with an unreadable log is filed under why', async () => {
  let { rows, commit } = await reported(false)
  assertEquals(rows.length, 1)
  let [{ error, message }] = rows
  assertEquals(
    error.fault,
    'build failed:yak:log unread: build logs returned HTTP 401',
  )
  assertEquals(error.commit, commit)
  assertEquals(error.tags.commit, commit)
  assertStringIncludes(message, 'at 0b580211')
  assertStringIncludes(message, 'build logs returned HTTP 401')
})

test('builds: a readable log is filed under its error', async () => {
  let { rows, commit } = await reported(true)
  assertEquals(rows.map((r) => r.error.fault), [
    'build failed:yak:Workers Builds setup: missing module',
  ])
  assertEquals(rows[0].error.commit, commit)
  assertStringIncludes(rows[0].message, 'error: missing module')
})
