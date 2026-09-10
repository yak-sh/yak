import { assertEquals, assertThrows } from '@std/assert'
import {
  append,
  built,
  probe,
  promotionTime,
  pushTime,
  summary,
  versionFor,
} from './deploy-time.ts'
import { type Deploy, gate, readRecords, records } from './deploy-gate.ts'
import type { Version } from '../src/yak_deploys.ts'

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

Deno.test('deploy time: an annotation outranks nearest time; unannotated fallback is explicit', () => {
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
})

Deno.test('deploy time: use push event, then check-suite, then original gate creation', () => {
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

Deno.test('deploy probe: only a 200 from the requested version is live', async () => {
  assertEquals(await probe(ID, fake(200, ID)), null)
  for (let status of [201, 302, 404, 503]) {
    assertEquals(await probe(ID, fake(status, ID)), `HTTP ${status}, want 200`)
  }
  assertEquals(await probe(ID, fake(200)), `version (missing), want ${ID}`)
  assertEquals(await probe(ID, fake(200, 'old')), `version old, want ${ID}`)
})

Deno.test('deploy probe: transport and body errors remain failures', async () => {
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

Deno.test('deploy timing: the commit under test is judged, not the last hand-recorded row', () => {
  // T-35336: rows were only appended by hand, so one unlucky Workers Builds
  // row stayed "the latest deploy" and failed every later commit. The gate step
  // records this commit's own deploy first, which puts it last by upload.
  let stale = [deploy(1, 40), deploy(2, 74)]
  assertEquals(gate(stale).code, 1)
  let fresh = gate([...stale, deploy(3, 47)])
  assertEquals([fresh.code, fresh.floor, fresh.limit], [0, 40, 50])
})

Deno.test('deploy timing: a commit Cloudflare never built has nothing to time', () => {
  // cdabdded touched only bin/ and .github/, outside the Worker's watch paths:
  // Cloudflare skipped it, no version was ever minted, and waiting for one
  // failed the gate. Only Cloudflare's own build check says a deploy is coming.
  assertEquals(built([{ name: 'gate' }, { name: 'dry-run' }]), false)
  assertEquals(built([]), false)
  assertEquals(built([{ name: 'gate' }, { name: 'Workers Builds: yak' }]), true)
})

Deno.test('deploy timing: the job summary carries the row the record accepts', () => {
  let rows = [deploy(1, 40), deploy(2, 47)]
  let text = summary(rows)
  assertEquals(records(text.split('```')[1]), rows)
  assertEquals(text.includes('bench/deploys.jsonl'), true)
})

Deno.test('deploy record: concurrent append is idempotent, and a failed probe can complete', async () => {
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
    assertEquals(gate(await readRecords(path)).code, 1)
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
    assertEquals(gate(await readRecords(path)).code, 0)
    assertEquals(gate(await readRecords(path)).floor, 25)
    assertEquals((await readRecords(path)).length, 3)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('deploy time: promotion excludes gate duration and names its source', () => {
  assertEquals(promotionTime(PUSHED), {
    pushed: '2026-09-07T19:00:00.000Z',
    pushSource: 'github:deploy-promotion',
  })
  assertThrows(
    () => promotionTime('not a date'),
    Error,
    'invalid DEPLOY_PUSHED_AT',
  )
})
