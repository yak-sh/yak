import { equal, test } from '@yaks/testing'
import type { Event } from '@yaks/trace'
import { inspect, phases } from './store-inspect.ts'
import { type Namespace, storeOf } from './door.ts'

let span = (
  name: string,
  duration: number,
  extra: Partial<Event> = {},
): Event => ({
  id: name,
  kind: 'phase',
  name,
  stage: 'end',
  time: duration,
  duration,
  package: '@yaks/graph',
  ...extra,
})

test('inspection sums completed pipeline phases without counting their children', () => {
  equal(
    phases([
      span('prepare', 0),
      span('gather', 2),
      span('gather', 3),
      span('transaction', 7),
      span('transaction', 11),
      span('mutate', 5),
      span('mutate', 4, { plugin: 'shop' }),
      span('audit', 6),
      span('effect', 8),
      span('apply', 20, { kind: 'apply' }),
      span('normalize', 2, { package: '@yaks/other' }),
      span('compose', 0, { stage: 'start', duration: undefined }),
      span('prepare', 1, { stage: 'instant' }),
    ]),
    { prepare: 0, gather: 5, transaction: 18, mutate: 5 },
  )
})

test('inspection carries a deletion window and its continuation to the Store', async () => {
  let asked: URL | undefined
  let deletions = { scanned: 1000, count: 20, minutes: {}, next: 2001 }
  let store = storeOf({
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (request: Request) => {
        asked = new URL(request.url)
        return Promise.resolve(Response.json({ deletions }))
      },
    }),
  } as unknown as Namespace, 'yak/platform')
  let window = {
    since: '2026-10-28T04:00:00Z',
    until: '2026-10-28T05:00:00Z',
    after: 1001,
  }
  equal(await inspect(store, { deletions: window }), { deletions })
  equal(Object.fromEntries(asked!.searchParams), {
    since: window.since,
    until: window.until,
    after: '1001',
  })
})
