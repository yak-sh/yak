import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import {
  append,
  finished,
  main,
  observe,
  probe,
  pushTime,
  summary,
  versionFor,
  type World,
} from './deploy-time.ts'
import {
  type Deploy,
  elsewhere,
  latest,
  readRecords,
  records,
  suite,
} from '../bench/deploy.ts'
import type { Version } from '../packages/admin/deploys.ts'

let SHA = 'a'.repeat(40)
let PUSHED = '2026-09-07T19:00:00Z'
let ID = '12345678-1234-1234-1234-123456789abc'
let version = (seconds: number, message?: string): Version => ({
  id: `${seconds}`,
  metadata: {
    created_on: new Date(Date.parse(PUSHED) + seconds * 1000).toISOString(),
  },
  annotations: message ? { 'workers/message': message } : {},
})

test('deploy time: an annotation outranks nearest time; unannotated fallback is explicit', () => {
  let nearest = version(10)
  let named = version(30, `${SHA} subject`)
  assertEquals(versionFor(SHA, PUSHED, [named, nearest]), {
    version: named,
    estimated: false,
  })
  assertEquals(versionFor(SHA, PUSHED, [version(30), nearest, version(-1)]), {
    version: nearest,
    estimated: true,
  })
  assertEquals(
    versionFor(SHA, PUSHED, [version(10, `${'b'.repeat(40)} another commit`)]),
    null,
  )
  assertEquals(versionFor(SHA, PUSHED, [version(-1)]), null)
  let short = version(25, `${SHA.slice(0, 8)} subject`)
  assertEquals(versionFor(SHA, PUSHED, [short])?.estimated, false)
  assertEquals(
    versionFor(SHA, PUSHED, [version(90, `${SHA} images`), named])?.version,
    named,
  )
})

test('deploy time: use push event, then check-suite, then original gate creation', () => {
  let event = {
    type: 'PushEvent',
    created_at: PUSHED,
    payload: { ref: 'refs/heads/main', head: SHA },
  }
  let suite = {
    head_sha: SHA,
    head_branch: 'main',
    created_at: '2026-09-07T19:00:01Z',
  }
  let run = { ...suite, event: 'push', created_at: '2026-09-07T19:00:02Z' }
  assertEquals(pushTime(SHA, [event], [suite], [run]), {
    pushed: PUSHED,
    pushSource: 'github:PushEvent',
  })
  assertEquals(pushTime(SHA, [], [suite], [run]), {
    pushed: suite.created_at,
    pushSource: 'github:check-suite',
  })
  assertEquals(
    pushTime(SHA, [], [], [
      { ...run, created_at: '2026-09-07T20:00:00Z' },
      run,
    ]),
    { pushed: run.created_at, pushSource: 'github:gate.created_at' },
  )
  assertEquals(
    pushTime(
      SHA,
      [{ ...event, payload: { ...event.payload, ref: 'refs/heads/topic' } }],
      [],
      [],
    ),
    null,
  )
  assertEquals(pushTime(SHA, [], [], [{ ...run, event: 'pull_request' }]), null)
  assertEquals(pushTime('b'.repeat(40), [event], [suite], [run]), null)
})

let fake = (status: number, served?: string) =>
  ((url: string | URL | Request, init?: RequestInit) => {
    assertEquals(url, 'https://yaks.app/')
    let headers = new Headers(init?.headers)
    assertEquals(
      headers.get('Cloudflare-Workers-Version-Overrides'),
      `yak="${ID}"`,
    )
    assertEquals(headers.get('cache-control'), 'no-cache')
    assertEquals(init?.redirect, 'manual')
    return Promise.resolve(
      new Response('page', {
        status,
        headers: served ? { 'x-yak-version': served } : {},
      }),
    )
  }) as typeof fetch

test('deploy probe: only a 200 from the requested version is live', async () => {
  assertEquals(await probe(ID, fake(200, ID)), null)
  for (let status of [201, 302, 404, 503]) {
    assertEquals(await probe(ID, fake(status, ID)), `HTTP ${status}, want 200`)
  }
  assertEquals(await probe(ID, fake(200)), `version (missing), want ${ID}`)
  assertEquals(await probe(ID, fake(200, 'old')), `version old, want ${ID}`)
})

test('deploy probe: transport and body errors remain failures', async () => {
  let dead = (() => Promise.reject(new Error('network down'))) as typeof fetch
  assertEquals(await probe(ID, dead), 'network down')
  let truncated = (() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('body truncated'))
          },
        }),
        { headers: { 'x-yak-version': ID } },
      ),
    )) as typeof fetch
  assertEquals(await probe(ID, truncated), 'body truncated')
})

test('deploy time: already serving uses its first active deployment, bounded by upload', async () => {
  let uploaded = version(20)
  uploaded.id = ID
  for (let seconds of [10, 25]) {
    let activation = version(seconds).metadata.created_on
    let result = await observe(uploaded, false, {
      check: (id) => probe(id, fake(200, ID)),
      now: () => Date.parse(PUSHED) + 90_000,
      history: () =>
        Promise.resolve({
          result: {
            deployments: [
              {
                id: 'later',
                created_on: version(50).metadata.created_on,
                versions: [{ version_id: ID, percentage: 100 }],
              },
              {
                id: 'inactive',
                created_on: PUSHED,
                versions: [{ version_id: ID, percentage: 0 }],
              },
              {
                id: 'first',
                created_on: activation,
                versions: [{ version_id: ID, percentage: 10 }],
              },
            ],
          },
        }),
    })
    assertEquals(result, {
      live: version(Math.max(20, seconds)).metadata.created_on,
      problem: null,
    })
    let row = {
      sha: SHA,
      pushed: PUSHED,
      uploaded: uploaded.metadata.created_on,
      live: result.live,
      seconds: Math.max(20, seconds),
    }
    assertEquals(records(JSON.stringify(row)), [row])
  }
})

test('deploy time: a later successful probe stamps its own clock', async () => {
  let uploaded = { ...version(20), id: ID }
  let clock = Date.parse(PUSHED) + 30_000
  let attempts = 0
  let result = await observe(uploaded, false, {
    check: (id) => probe(id, fake(200, attempts++ ? ID : 'old')),
    now: () => clock,
    wait: () => {
      clock += 1000
      return Promise.resolve()
    },
    history: () => {
      throw new Error('a later probe must use its own clock')
    },
  })
  assertEquals(attempts, 2)
  assertEquals(result, { live: version(31).metadata.created_on, problem: null })
})

test('deploy time: a recorder that began after the deployment times it by the deployment', async () => {
  let uploaded = { ...version(20), id: ID }
  let deployed = version(25).metadata.created_on
  let clock = Date.parse(PUSHED) + 300_000
  let attempts = 0
  let result = await observe(uploaded, false, {
    check: (id) => probe(id, fake(200, attempts++ ? ID : 'old')),
    now: () => clock,
    wait: () => {
      clock += 1000
      return Promise.resolve()
    },
    history: () =>
      Promise.resolve({
        result: {
          deployments: [{
            id: 'live',
            created_on: deployed,
            versions: [{ version_id: ID, percentage: 100 }],
          }],
        },
      }),
  })
  assertEquals(result, { live: deployed, problem: null })
})

test('deploy time: slow discovery cannot delay target verification or rewrite its timestamp', async () => {
  let time = clock(Date.parse(PUSHED) + 30_000)
  let discovery = Promise.withResolvers<Version[]>()
  let verified = Promise.withResolvers<void>()
  let checked: number[] = []
  let listings = 0
  let settled = false
  let result = observe(version(20, `${SHA} worker`), false, {
    now: () => {
      if (checked.length == 2) verified.resolve()
      return time.now()
    },
    wait: () => time.advance(1000),
    related: () => {
      listings++
      return discovery.promise
    },
    check: async () => {
      checked.push(time.now())
      if (checked.length == 1) return 'inactive version'
      await time.advance(250)
      return null
    },
    history: () => {
      throw new Error('a later target verification must not use activation')
    },
  }).then((row) => {
    settled = true
    return row
  })
  await verified.promise
  assertEquals(checked, [
    Date.parse(PUSHED) + 30_000,
    Date.parse(PUSHED) + 31_000,
  ])
  assertEquals(listings, 1)
  assertEquals(settled, false)
  // The pending listing is owned until it settles, but verification has
  // already happened. Its 38s cleanup cannot backdate or delay that stamp.
  await time.advance(38_000)
  assertEquals(settled, false)
  discovery.resolve([])
  assertEquals(await result, {
    live: version(31.25).metadata.created_on,
    problem: null,
  })
  assertEquals(settled, true)
})

test('deploy time: discovery refreshes are spaced, single-flight, and retain sibling activation', async () => {
  let time = clock(Date.parse(PUSHED) + 30_000)
  let uploaded = version(20, `${SHA} worker`)
  let sibling = version(40, `${SHA} images`)
  let discovery = Promise.withResolvers<Version[]>()
  let listings: number[] = []
  let checked: number[] = []
  let start = time.now()
  let result = await observe(uploaded, false, {
    now: time.now,
    wait: () => time.advance(1000),
    related: () => {
      listings.push(time.now() - start)
      return listings.length == 1
        ? discovery.promise
        : Promise.resolve([sibling])
    },
    check: (id) => {
      if (id == sibling.id) return Promise.resolve(null)
      let elapsed = time.now() - start
      checked.push(elapsed)
      if (elapsed == 15_000) discovery.resolve([])
      return Promise.resolve('inactive version')
    },
    history: () =>
      Promise.resolve([{
        id: 'first',
        created_on: version(25).metadata.created_on,
        versions: [{ version_id: uploaded.id, percentage: 100 }],
      }]),
  })
  assertEquals(listings, [0, 25_000])
  assertEquals(checked, Array.from({ length: 26 }, (_, n) => n * 1000))
  assertEquals(result, { live: version(25).metadata.created_on, problem: null })
})

test('deploy time: a serving same-commit sibling verifies the earliest activation', async () => {
  let uploaded = { ...version(20, `${SHA} worker`), id: ID }
  let sibling = version(80, `${SHA.slice(0, 8)} images`)
  let checked: string[] = []
  let result = await observe(uploaded, false, {
    sha: SHA,
    check: (id) => {
      checked.push(id)
      return Promise.resolve(id == sibling.id ? null : 'inactive version')
    },
    related: () => Promise.resolve([sibling]),
    now: () => Date.parse(PUSHED) + 100_000,
    wait: () => {
      throw new Error('already serving commit must not wait')
    },
    history: () =>
      Promise.resolve([
        {
          id: 'images',
          created_on: version(85).metadata.created_on,
          versions: [{ version_id: sibling.id, percentage: 100 }],
        },
        {
          id: 'worker',
          created_on: version(25).metadata.created_on,
          versions: [{ version_id: ID, percentage: 100 }],
        },
      ]),
  })
  assertEquals(checked, [ID, sibling.id])
  assertEquals(result, { live: version(25).metadata.created_on, problem: null })
})

test('deploy time: sibling serving cannot invent a missing earliest activation', async () => {
  let uploaded = { ...version(20, `${SHA} worker`), id: ID }
  let sibling = version(80, `${SHA} images`)
  await assertRejects(
    () =>
      observe(uploaded, true, {
        check: (id) =>
          Promise.resolve(id == sibling.id ? null : 'inactive version'),
        related: () => Promise.resolve([sibling]),
        history: () =>
          Promise.resolve([
            {
              id: 'images',
              created_on: version(85).metadata.created_on,
              versions: [{ version_id: sibling.id, percentage: 100 }],
            },
          ]),
      }),
    Error,
    `no deployment time for serving version ${ID}`,
  )
})

test('deploy time: an unrelated or unnamed serving version cannot verify the commit', async () => {
  let uploaded = { ...version(20, `${SHA} worker`), id: ID }
  let checked: string[] = []
  let result = await observe(uploaded, true, {
    check: (id) => {
      checked.push(id)
      return Promise.resolve(id == ID ? 'inactive version' : null)
    },
    related: () =>
      Promise.resolve([
        version(80, `${'b'.repeat(40)} different`),
        version(90),
      ]),
    history: () => {
      throw new Error('unverified serving must not use history')
    },
  })
  assertEquals(checked, [ID])
  assertEquals(result, { live: null, problem: 'inactive version' })
})

test('deploy time: a commit annotation cannot verify an inferred earliest version', async () => {
  let uploaded = { ...version(20), id: ID }
  let checked: string[] = []
  let result = await observe(uploaded, true, {
    sha: SHA,
    check: (id) => {
      checked.push(id)
      return Promise.resolve(id == ID ? 'inactive version' : null)
    },
    related: () => Promise.resolve([version(80, `${SHA} images`)]),
  })
  assertEquals(checked, [ID])
  assertEquals(result, { live: null, problem: 'inactive version' })
})

// The gate's recorder on SHA, pushed at PUSHED, in a world that answers as
// GitHub, Cloudflare and yaks.app would: `built` is Cloudflare's finished
// check run (none while it builds), `uploads` the versions wrangler lists,
// and `answer` what every probe of yaks.app finds. The runner's token cannot
// read Workers Builds. A wait is ten seconds.
let recorder = (
  { built, uploads = [], answer = elsewhere('old', ID) }: {
    built?: string
    uploads?: Version[]
    answer?: string
  } = {},
) => {
  let time = clock(Date.parse(PUSHED) + 5_000)
  let github: Record<string, unknown> = {
    'events?per_page=100': [],
    'actions/workflows/gate.yml/runs?event=push&branch=main&per_page=100': {
      workflow_runs: [{
        head_sha: SHA,
        created_at: PUSHED,
        event: 'push',
        head_branch: 'main',
      }],
    },
    [`commits/${SHA}/check-suites`]: { check_suites: [] },
    [`commits/${SHA}`]: { parents: [{ sha: 'b'.repeat(40) }] },
    [`commits/${SHA}/check-runs`]: {
      check_runs: built
        ? [{
          name: 'Workers Builds: yak',
          status: 'completed',
          conclusion: built,
        }]
        : [],
    },
    'commits/main': { sha: SHA },
  }
  let said: string[] = []
  let rows: Deploy[] = []
  let world: Partial<World> = {
    api: (path) =>
      path in github
        ? Promise.resolve(github[path])
        : Promise.reject(new Error(`gh: ${path}`)),
    versions: () => Promise.resolve(uploads),
    history: () => Promise.resolve([]),
    changed: () => Promise.resolve(true),
    check: () => Promise.resolve(answer),
    started: () => Promise.reject(new Error('builds: HTTP 401')),
    read: () => Promise.resolve([]),
    append: (row) => Promise.resolve(rows.push(row) > 0),
    job: () => Promise.resolve(),
    say: (line) => said.push(line),
    now: time.now,
    wait: () => time.advance(10_000),
  }
  return { world, said, rows }
}

for (
  let [built, why] of [
    [undefined, "Cloudflare's build has not finished after 900s"],
    ['success', 'Cloudflare built it but uploaded no version within 60s'],
    ['failure', "Cloudflare's build failed: failure"],
  ]
) {
  test(`deploy time: "${why}" is said, untimed, and nothing fails`, async () => {
    let { world, said, rows } = recorder({ built })
    await main([SHA], world)
    assertEquals(said, [`${SHA.slice(0, 8)}: ${why} — not timed`])
    assertEquals(rows, [])
  })
}

// What the deploy gate makes of the rows: its bench, null, or why it fails.
let judged = (rows: Deploy[]) => {
  try {
    return suite(rows)
  } catch (e) {
    return (e as Error).message
  }
}

let uploaded = { ...version(40, `${SHA} subject`), id: ID }
for (
  let [answer, gate, verdict] of [
    [elsewhere('old', ID), null, 'judges nothing'],
    [
      'HTTP 503, want 200',
      'yaks.app did not answer 200: HTTP 503, want 200',
      'fails: yaks.app never answered',
    ],
  ] as const
) {
  test(`deploy time: a version never seen answering is recorded unverified, nothing fails, and the deploy gate ${verdict}`, async () => {
    let { world, said, rows } = recorder({ uploads: [uploaded], answer })
    await main([SHA], world)
    assertEquals(rows, [{
      sha: SHA,
      pushed: PUSHED,
      pushSource: 'github:gate.created_at',
      uploaded: uploaded.metadata.created_on,
      live: null,
      seconds: null,
      version: ID,
      estimated: false,
      probe: answer,
    }])
    assertEquals(said, [
      `${SHA.slice(0, 8)}: build start unknown — builds: HTTP 401`,
      `${
        SHA.slice(0, 8)
      }: upload 40.000s; live unverified: ${answer} — recorded`,
    ])
    assertEquals(judged(rows), gate && `${SHA.slice(0, 8)}: ${gate}`)
  })
}

test('deploy time: yaks.app answering from another version outweighs a later probe that got nothing', async () => {
  // A deploy leaves the home page cold for seconds: probes time out, then
  // the version before answers again.
  let time = clock(Date.parse(PUSHED))
  let probes = 0
  let result = await observe({ ...version(20), id: ID }, false, {
    check: () =>
      Promise.resolve(
        probes++ % 2 ? 'Signal timed out.' : elsewhere('old', ID),
      ),
    now: time.now,
    wait: () => time.advance(10_000),
  })
  assertEquals(result, { live: null, problem: elsewhere('old', ID) })
})

let deploy = (n: number, seconds: number): Deploy => {
  let pushed = new Date(Date.parse(PUSHED) + n * 600_000).toISOString()
  return {
    sha: `${n}`.padStart(40, 'c'),
    pushed,
    uploaded: new Date(Date.parse(pushed) + seconds * 500).toISOString(),
    live: new Date(Date.parse(pushed) + seconds * 1000).toISOString(),
    seconds,
  }
}

test('deploy timing: the commit under test is judged, not the last hand-recorded row', () => {
  // T-35336: rows were only appended by hand, so one unlucky Workers Builds
  // row stayed "the latest deploy" and failed every later commit. The gate step
  // records this commit's own deploy first, which puts it last by upload.
  let stale = [deploy(1, 40), deploy(2, 74)]
  assertEquals(latest(stale)?.seconds, 74)
  assertEquals(latest([...stale, deploy(3, 47)])?.seconds, 47)
})

test("deploy timing: a build is finished once the kernel Worker's check run completes", () => {
  let run = (name: string, status = 'completed', conclusion = 'success') => ({
    name,
    status,
    conclusion,
  })
  let yak = run('Workers Builds: yak')
  assertEquals(finished([run('gate'), run('dry-run')]), undefined)
  assertEquals(finished([]), undefined)
  assertEquals(finished([run('gate'), yak]), yak)
  assertEquals(finished([run('Workers Builds: yak-tracker')]), undefined)
  // 63f4a372's build was posted in progress, with no conclusion yet.
  assertEquals(
    finished([{
      name: 'Workers Builds: yak',
      status: 'in_progress',
      conclusion: null,
    }]),
    undefined,
  )
})

test('deploy timing: the job summary carries the row the record accepts', () => {
  let rows = [deploy(1, 40), deploy(2, 47)]
  let text = summary(rows)
  assertEquals(records(text.split('```')[1]), rows)
  assertEquals(text.includes('bench/deploys.jsonl'), true)
})

test('deploy record: concurrent append is idempotent, and a failed probe can complete', async () => {
  let dir = await Deno.makeTempDir()
  let path = `${dir}/deploys.jsonl`
  let row: Deploy = {
    sha: SHA,
    pushed: PUSHED,
    uploaded: '2026-09-07T19:00:20Z',
    live: null,
    seconds: null,
    backfill: true,
  }
  try {
    assertEquals(await Promise.all([append(row, path), append(row, path)]), [
      true,
      false,
    ])
    let failed = { ...row, backfill: false }
    assertEquals(await append(failed, path), true)
    assertEquals(suite(records(Deno.readTextFileSync(path))), null)
    let live = { ...failed, live: '2026-09-07T19:00:25Z', seconds: 25 }
    assertEquals(await append(live, path), true)
    assertEquals(
      await append(
        { ...live, live: '2026-09-07T19:00:26Z', seconds: 26 },
        path,
      ),
      false,
    )
    assertEquals(await append(row, path), false)
    assertEquals(latest(await readRecords(path))?.seconds, 25)
    assertEquals((await readRecords(path)).length, 3)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
