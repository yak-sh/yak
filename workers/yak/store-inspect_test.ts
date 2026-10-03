import { equal, test } from '@yaks/testing'
import type { Event } from '@yaks/trace'
import { phases } from './store-inspect.ts'

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
