import { equal, test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { admitSchema } from '@yaks/graph/schema'
import { refuse } from '@yaks/api'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { answered } from './meta.ts'
import { mistaken } from './mistake.ts'
import { breaks, folds, line, type Seen } from './unseen.ts'
import type { App } from './directory.ts'

let words = loadVocab([{
  $defs: {
    signature: {
      component: true,
      type: 'object',
      properties: {
        stars: { type: 'number' },
        note: { type: 'string', validate: true, maxLength: 8 },
      },
    },
  },
}])
let store = graph({
  storage: ram(words),
  vocab: words,
  plugins: [admitSchema(words)],
})
let heard = async (signature: Comp) => {
  try {
    await store.apply([{ entity: { eid: crypto.randomUUID() }, signature }])
    return null
  } catch (error) {
    let response = refuse(error)!
    return { status: response.status, error: await answered(response) }
  }
}
// The store's wire answers are inputs to the page door, without a Store boot.
let [wrong, again, bound, valid] = await Promise.all([
  heard({ stars: '5' }),
  heard({ stars: '4' }),
  heard({ note: 'far too long' }),
  heard({ stars: 5, note: 'lovely' }),
])
let page = (
  app = 'guests',
  headers: Record<string, string> = { 'x-yak-version': '7' },
) =>
  new Request(`https://books.yaks.app/${app}/api/apply`, {
    method: 'POST',
    headers,
  })
let read = () => Promise.resolve(9)
let recording = () => {
  let reports: Parameters<Parameters<typeof mistaken>[3]['note']>[0][] = []
  return {
    reports,
    version: read,
    note: (report: typeof reports[number]) =>
      Promise.resolve(void reports.push(report)),
  }
}
let write = page()
let limited = page()
let wall = page('wall')
let outside = page('guests', {})
let foreign = page('guests', {})
let sameOrigin = page('guests', { 'sec-fetch-site': 'same-origin' })

test("a write the app's own vocabulary refuses is a break", async () => {
  let reporter = recording()
  await mistaken(write, wrong!.error, 'apply', reporter)
  equal(wrong!.status, 400)
  equal(reporter.reports, [{
    request: 'POST /guests/api/apply',
    version: 7,
    message: 'signature.stars is a number',
    mistake: true,
  }])
})

test('a schema bound refuses visitor input without filing a page break', async () => {
  let reporter = recording()
  await mistaken(limited, bound!.error, 'apply', reporter)
  equal(bound!.status, 400)
  equal(reporter.reports, [])
  equal(valid, null)
})

let recurrence = recording()
await mistaken(page(), wrong!.error, 'apply', recurrence)
await mistaken(page(), again!.error, 'apply', recurrence)
let app = { eid: 'guests', slug: 'guests' } as App
let seen: Seen[] = recurrence.reports.map((report, n) => ({
  app,
  hit: {
    kind: 'exception',
    entity: { eid: String(n) },
    exception: { ...report, value: report.message, at: '2026-10-14' },
  },
}))
test('repeated refused writes are one open break with both occurrences', () => {
  let grouped = folds(seen)
  equal(grouped.length, 1)
  equal(breaks(seen.map((s) => s.hit)), 1)
})

let grouped = folds(seen)
test('the refused write report names its page release and recurrence count', () => {
  let said = line(grouped[0])
  equal(said.includes('guests v7: POST /guests/api/apply'), true)
  equal(said.includes('(2 times'), true)
})

test('a write through another vocabulary home is attributed to its page', async () => {
  let reporter = recording()
  await mistaken(wall, wrong!.error, 'apply', reporter)
  equal(reporter.reports[0].request, 'POST /wall/api/apply')
})

test('an outside caller writes no page break, even for a malformed query', async () => {
  let reporter = recording()
  await mistaken(outside, wrong!.error, 'apply', reporter)
  await mistaken(
    foreign,
    new Refused('unknown prop'),
    'query',
    reporter,
  )
  equal(reporter.reports, [])
})

test('a same-origin page without a release header reads the serving release', async () => {
  let reporter = recording()
  await mistaken(
    sameOrigin,
    new Refused('unknown prop'),
    'query',
    reporter,
  )
  equal(reporter.reports[0].version, 9)
})
