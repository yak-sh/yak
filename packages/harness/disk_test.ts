import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  available,
  type DiskAlert,
  diskEvent,
  diskMonitor,
  failureEvent,
  sentryReporter,
} from './disk.ts'

test('disk space reads POSIX df available KiB, including a full disk', () => {
  let df = (free: string) =>
    'Filesystem 1024-blocks Used Available Capacity Mounted on\n' +
    `/dev/root 10000 9000 ${free} 90% /\n`
  assertEquals(available(df('1000')), 1_024_000)
  assertEquals(available(df('0')), 0)
  for (let text of [df('no'), df('-1'), 'unreadable']) {
    assertThrows(() => available(text))
  }
})

test('disk alert reports below threshold once and re-arms after recovery', async () => {
  let free = 100, alerts: DiskAlert[] = []
  let check = diskMonitor({
    threshold: 100,
    free: () => Promise.resolve(free),
    report: (alert) => {
      alerts.push(alert)
      return Promise.resolve()
    },
  })
  for (let next of [100, 99, 20, 0, 100, 99]) {
    free = next
    await check()
  }
  assertEquals(alerts, [
    { path: '/', free: 99, threshold: 100 },
    { path: '/', free: 99, threshold: 100 },
  ])
})

test('failed probes and deliveries remain visible and retryable', async () => {
  let free = -1, delivers = 0, fail = true
  let check = diskMonitor({
    threshold: 100,
    free: () => Promise.resolve(free),
    report: () => {
      delivers++
      return fail ? Promise.reject(new Error('offline')) : Promise.resolve()
    },
  })
  await assertRejects(check, Error, 'invalid available')
  assertEquals(delivers, 0)
  free = 0
  await assertRejects(check, Error, 'offline')
  fail = false
  await check()
  await check()
  assertEquals(delivers, 2)
  let broken = diskMonitor({
    free: () => Promise.reject(new Error('df failed')),
    report: () => Promise.resolve(),
  })
  await assertRejects(broken, Error, 'df failed')
})

let target = {
  api: 'https://sentry.example/api/0',
  org: 'yaks',
  project: 'yaks-app',
  environment: 'production',
}
let alert = { path: '/', free: 0, threshold: 10 * 1024 ** 3 }
let dsn = 'https://public-key@ingest.example/42'

test('disk alert finds an active Sentry key and sends an error in the admin environment', async () => {
  let calls = 0
  let report = sentryReporter({
    target,
    token: () => Promise.resolve('read-token'),
    fetch: (input, init) => {
      let req = new Request(input, init)
      calls++
      if (calls == 1) {
        assertEquals(
          req.url,
          `${target.api}/organizations/yaks/projects/?query=yaks-app`,
        )
        assertEquals(req.headers.get('authorization'), 'Bearer read-token')
        return Promise.resolve(Response.json([
          { id: '21', slug: 'yaks-app-dev' },
          { id: '42', slug: 'yaks-app' },
        ]))
      }
      if (calls == 2 || calls == 3) {
        assertEquals(req.headers.get('authorization'), 'Bearer read-token')
        assertEquals(
          req.url,
          `${target.api}/organizations/yaks/project-keys/?status=active${
            calls == 3 ? '&cursor=more' : ''
          }`,
        )
        return Promise.resolve(
          calls == 2
            ? Response.json([
              {
                projectId: 21,
                isActive: true,
                dsn: { public: 'https://wrong@example/21' },
              },
              {
                projectId: 42,
                isActive: false,
                dsn: { public: 'https://inactive@example/42' },
              },
            ], {
              headers: {
                link:
                  '<https://sentry.example/ignored>; rel="next"; results="true"; cursor="more"',
              },
            })
            : Response.json([
              { projectId: 42, isActive: true, dsn: { public: dsn } },
            ]),
        )
      }
      assertEquals(req.url, 'https://ingest.example/api/42/store/')
      assertEquals(req.headers.get('authorization'), null)
      assertEquals(
        req.headers.get('x-sentry-auth'),
        'Sentry sentry_version=7, sentry_key=public-key',
      )
      return req.json().then((event) => {
        assertEquals(event.environment, 'production')
        assertEquals(event.level, 'error')
        assertEquals(event.exception.values[0].type, 'LowDiskSpace')
        assertEquals(event.extra, {
          free_bytes: 0,
          threshold_bytes: alert.threshold,
        })
        assertEquals(event.tags.path, '/')
        return Response.json({ id: event.event_id })
      })
    },
  })
  await report(diskEvent(alert))
  await report(diskEvent(alert))
  assertEquals(calls, 5)
})

test('configured ingest DSN needs no admin token; failed sends retry', async () => {
  let calls = 0
  let report = sentryReporter({
    target,
    token: () => Promise.reject(new Error('should not need token')),
    dsn: () => Promise.resolve(dsn),
    fetch: () => {
      calls++
      return Promise.resolve(
        new Response('', { status: calls == 1 ? 503 : 200 }),
      )
    },
  })
  await assertRejects(() => report(diskEvent(alert)), Error, '503')
  await report(diskEvent(alert))
  assertEquals(calls, 2)
})

test('missing credentials and refused key discovery fail instead of silencing alerts', async () => {
  let report = sentryReporter({ token: () => Promise.resolve(undefined) })
  await assertRejects(
    () => report(diskEvent(alert)),
    Error,
    'No Sentry credential',
  )
  report = sentryReporter({
    token: () => Promise.resolve('read-token'),
    fetch: () => Promise.resolve(new Response('', { status: 403 })),
  })
  await assertRejects(() => report(diskEvent(alert)), Error, '403')
})

test('maintenance failures use the same error delivery without disk-specific fields', async () => {
  let report = sentryReporter({
    target,
    token: () => Promise.reject(new Error('should not need token')),
    dsn: () => Promise.resolve(dsn),
    fetch: (input, init) =>
      new Request(input, init).json().then((event) => {
        assertEquals(event.tags, { phase: 'worktree-sweep', service: 'yak' })
        assertEquals(event.exception.values[0].type, 'Error')
        assertEquals(
          event.exception.values[0].value.includes('cannot sweep'),
          true,
        )
        assertEquals(event.extra, undefined)
        return Response.json({ id: event.event_id })
      }),
  })
  await report(failureEvent(new Error('cannot sweep'), 'worktree-sweep'))
})
