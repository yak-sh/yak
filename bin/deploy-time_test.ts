import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  append,
  build,
  observe,
  probe,
  pushTime,
  summary,
  versionFor,
} from './deploy-time.ts'
import {
  type Deploy,
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

test("deploy timing: a build is finished once the kernel Worker's check run is posted", () => {
  let yak = { name: 'Workers Builds: yak' }
  assertEquals(build([{ name: 'gate' }, { name: 'dry-run' }]), undefined)
  assertEquals(build([]), undefined)
  assertEquals(build([{ name: 'gate' }, yak]), yak)
  assertEquals(build([{ name: 'Workers Builds: yak-tracker' }]), undefined)
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
    assertThrows(
      () => suite(records(Deno.readTextFileSync(path))),
      Error,
      'no verified live response',
    )
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
