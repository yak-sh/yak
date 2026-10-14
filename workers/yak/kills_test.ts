// The directory's kill sweep (kills.ts): each run reads Cloudflare's record of
// the minutes since the last one and reports every kill it finds there, once.
import { clock, equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { within } from './defects.ts'
import { platform } from './testing.ts'
import { KERNEL, meta } from './meta.ts'
import { PLATFORM_STORE } from './door.ts'

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
    let rows: Bundle[] = []
    let p = platform('kills', {
      CF_ANALYTICS_TOKEN: 'test',
      ERRORS: { send: (s: Bundle[]) => (rows.push(...s), Promise.resolve()) },
    })
    let store = p.object(PLATFORM_STORE)
    await store.fetch(
      new Request('http://store/vocab', {
        method: 'POST',
        headers: { 'x-store': PLATFORM_STORE, ...KERNEL },
        body: '{}',
      }),
    )
    await p.settled()
    await meta(p.env).apply([{
      entity: { eid: 'yak-kills' },
      wake: { at: iso('05:00') },
      sweep: { through: iso('04:50') },
    }], KERNEL)
    for (let time of ['05:00', '05:05']) {
      await within(p.env, {}, () => store.tick(at(time)), clock())
    }
    equal(asked.map((v) => [v.script, v.since, v.until]), [
      ['yak', iso('04:50'), iso('04:55')],
      ['yak', iso('04:55'), iso('05:00')],
    ])
    equal(
      rows.flatMap((r) => {
        let error = r.error as { tags: unknown; commit: string } | undefined
        let exception = r.exception as { value: string } | undefined
        return exception ? [[exception.value, error?.tags, error?.commit]] : []
      }),
      [
        ["a Durable Object's alarm was killed: exceededCpu", {
          request: 'alarm',
          store: 'ada/notes',
          at: '2026-09-07T04:52:00Z',
          count: '2',
        }, 'v1'],
        ["a Durable Object's socket message was killed: exceededMemory", {
          request: 'hibernation',
          store: 'ada/notes',
          at: '2026-09-07T04:52:00Z',
          count: '2',
        }, 'v1'],
      ],
    )
  } finally {
    globalThis.fetch = fetch
  }
})
