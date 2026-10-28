// The directory's kill sweep (kills.ts): each run reads Cloudflare's record of
// the minutes since the last one and reports every kill it finds there, once.
import { equal, test } from '@yaks/testing'
import { swept } from './kills.ts'
import type { Env } from './env.ts'

let wait = () => Promise.resolve()

let at = (time: string) => Date.parse(`2026-09-07T${time}:00Z`)
let iso = (time: string) => new Date(at(time)).toISOString()
let kill = (type: string, status: string) => ({
  dimensions: {
    datetimeMinute: '2026-09-07T04:52:00Z',
    name: 'ada/notes',
    objectId: '70e2ab05',
    scriptVersion: 'v1',
    status,
    type,
  },
  sum: { requests: 2 },
})

test('each run reports the kills since the last one, and reads on from there', async () => {
  let asked: Record<string, string>[] = []
  let answers = [[
    kill('alarm', 'exceededCpu'),
    kill('hibernation', 'exceededMemory'),
  ]]
  let fetch = globalThis.fetch
  globalThis.fetch = (_url, init) => {
    asked.push(JSON.parse(String(init?.body)).variables)
    return Promise.resolve(Response.json({
      data: {
        viewer: {
          accounts: [{
            durableObjectsInvocationsAdaptiveGroups: answers.shift() ?? [],
          }],
        },
      },
    }))
  }
  try {
    let env = { CF_ANALYTICS_TOKEN: 'test' } as Env
    let reports: unknown[] = []
    let report = (e: unknown, tags: unknown, details: unknown) =>
      void reports.push([(e as Error).message, tags, details])
    let through: string | null = iso('04:50')
    for (let time of ['05:00', '05:05']) {
      through = await swept(env, through, at(time), report, wait)
    }
    equal(through, iso('05:00'))
    equal(asked.map((v) => [v.script, v.since, v.until]), [
      ['yak', iso('04:50'), iso('04:55')],
      ['yak', iso('04:55'), iso('05:00')],
    ])
    let tags = (request: string) => ({
      request,
      store: 'ada/notes',
      at: '2026-09-07T04:52:00Z',
      count: '2',
    })
    equal(reports, [
      [
        "a Durable Object's alarm was killed: exceededCpu",
        tags('alarm'),
        { commit: 'v1' },
      ],
      [
        "a Durable Object's socket message was killed: exceededMemory",
        tags('hibernation'),
        { commit: 'v1' },
      ],
    ])
  } finally {
    globalThis.fetch = fetch
  }
})

// 2026-10-28T17:48Z: Cloudflare answered the sweep's query 500, "Internal
// authentication error: internal server error". Sent again, it answers; one
// it fails through every resend is `Unavailable` (wake.ts `reporting`), and a
// token it refuses is a failure of ours.
let SAID = JSON.stringify({
  success: false,
  errors: [{
    code: 10500,
    message: 'Internal authentication error: internal server error',
  }],
})
let after = async (statuses: number[]) => {
  let fetch = globalThis.fetch
  globalThis.fetch = () => {
    let status = statuses.shift() ?? 200
    return Promise.resolve(
      status == 200
        ? Response.json({ data: { viewer: { accounts: [{}] } } })
        : new Response(SAID, { status }),
    )
  }
  try {
    let env = { CF_ANALYTICS_TOKEN: 'test' } as Env
    return await swept(env, iso('04:50'), at('05:00'), () => {}, wait)
      .catch((e: Error) => e.name)
  } finally {
    globalThis.fetch = fetch
  }
}

test('a query Cloudflare fails on its own side is sent again, and one it fails throughout is Unavailable', async () => {
  let got = []
  for (let statuses of [[500], [500, 500, 500, 500], [403]]) {
    got.push(await after(statuses))
  }
  equal(got, [iso('04:55'), 'Unavailable', 'Error'])
})
