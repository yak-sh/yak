// admin_errors reads every tracker on yaks.app: the platform's and each
// space's the platform lists, through the same signed doors.
import { equal, ok, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import { door } from '../../workers/tracker/door.ts'
import { options, platform, store, vocab } from '../../workers/tracker/core.ts'
import { errors } from './errors.ts'

let secret = 'test-only'
let remote = { url: 'https://tracker.test', secret }
let space = '00000000-0000-4000-8000-0000000000a1'
let gone = '00000000-0000-4000-8000-0000000000a2'
let tracker = async (scope: string, bugs: [string, string, string][]) => {
  let s = store(ram(vocab, options), { sink: () => {} })
  await s.graph.apply(
    bugs.map(([eid, title, last]) => ({
      entity: { eid },
      doc: { title },
      bug: { fault: title, hits: 1, first: last, last },
    })),
    { trusted: true },
  )
  return door(s, scope, secret)
}
let doors = new Map([
  [
    'platform',
    await tracker(platform, [[
      crypto.randomUUID(),
      'platform broke',
      '2026-11-01T00:00:00Z',
    ]]),
  ],
  [
    space,
    await tracker(space, [[
      crypto.randomUUID(),
      'space broke',
      '2026-11-02T00:00:00Z',
    ]]),
  ],
])
let go = ((url: URL, init?: RequestInit) => {
  let at = new URL(url)
  if (at.pathname == '/scopes') {
    return Promise.resolve(Response.json({ scopes: [space, gone] }))
  }
  let scope = at.searchParams.get('scope')!
  return doors.get(scope)?.(new Request(url, init)) ??
    Promise.resolve(new Response('', { status: 403 }))
}) as typeof fetch

test("admin_errors lists every space tracker's unresolved bugs beside the platform's, newest first, naming the space", async () => {
  let report = await errors(undefined, { remote }, { fetch: go })
  ok(report[0].startsWith('Tracker: 2 unresolved bugs'))
  equal(
    report.slice(2, 4).map((line) => line.split('  ').slice(4, 5)[0]),
    [space, 'platform'],
  )
  ok(report[3].endsWith('platform broke'))
  ok(
    report.includes(
      `Not read: space ${gone}: Remote tracker refused the read (403)`,
    ),
  )
})
