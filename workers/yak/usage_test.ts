// The meter's one seam that needs no runtime: an analytics answer read into
// rows by store name (usage.ts `read`). The fixture is a recorded answer,
// trimmed — the shape of
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
// (data.viewer.accounts[0].<dataset>[].dimensions/sum) with the Durable
// Object datasets documented at
// https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
// and the field names this account's own schema introspects to.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { Meter, Space, Tier } from './directory.ts'
import { atCeiling, FREE, level, read, size, standing } from './usage.ts'

let ANSWER = {
  data: {
    viewer: {
      accounts: [{
        durableObjectsInvocationsAdaptiveGroups: [
          { dimensions: { name: 'jeff/recipe-box' }, sum: { requests: 93 } },
          { dimensions: { name: 'yak/platform' }, sum: { requests: 2176 } },
          // Not an app of ours: nobody asks for it, and it costs nothing to
          // carry.
          {
            dimensions: { name: 'cf-singleton-container' },
            sum: { requests: 72 },
          },
        ],
        durableObjectsPeriodicGroups: [
          {
            dimensions: { name: 'jeff/recipe-box' },
            sum: { rowsRead: 48358, rowsWritten: 1632 },
          },
          {
            dimensions: { name: 'yak/platform' },
            sum: { rowsRead: 872425, rowsWritten: 8741 },
          },
        ],
      }],
    },
  },
  errors: null,
}

Deno.test('an analytics answer reads as one row per store', () => {
  let by = read(ANSWER)
  assertEquals(by.get('jeff/recipe-box'), {
    requests: 93,
    rows_read: 48358,
    rows_written: 1632,
  })
  assertEquals(by.get('yak/platform')?.rows_written, 8741)
  // A store the datasets never named is not zero — it is absent, and the
  // sweep writes zeros for it from its own list of apps.
  assertEquals(by.get('jeff/nothing-yet'), undefined)
})

Deno.test('a store in one dataset and not the other still reads', () => {
  let by = read({
    data: {
      viewer: {
        accounts: [{
          durableObjectsInvocationsAdaptiveGroups: [
            { dimensions: { name: 'jeff/quiet' }, sum: { requests: 4 } },
          ],
          durableObjectsPeriodicGroups: [],
        }],
      },
    },
  })
  assertEquals(by.get('jeff/quiet'), {
    requests: 4,
    rows_read: 0,
    rows_written: 0,
  })
})

Deno.test('a token that may not read analytics is a throw, not a zero', () => {
  // The API answers 200 with `errors` for an unauthorized token; metering
  // everyone at zero would quietly say every space is idle.
  assertThrows(
    () => read({ data: null as never, errors: [{ message: 'unauthorized' }] }),
    Error,
    'unauthorized',
  )
})

Deno.test('bytes read as a person says them', () => {
  assertEquals(size(0), '0 B')
  assertEquals(size(999), '999 B')
  assertEquals(size(1536), '1.5 KB')
  assertEquals(size(252_706_816), '241 MB')
  assertEquals(size(1024 ** 3), '1 GB')
})

// The ceilings, at the seam every door reads (T-32758).
let NOW = new Date('2026-09-15T12:00:00Z')

let space = (meter: Partial<Meter> = {}, tier: Tier | null = null): Space => ({
  eid: 'e1',
  slug: 'jeff',
  home: null,
  title: 'Jeff',
  tier,
  plan: null,
  told: false,
  meter: {
    month: '2026-09',
    requests: 0,
    rows_read: 0,
    rows_written: 0,
    bytes: 0,
    emails: 0,
    at: NOW.toISOString(),
    ...meter,
  },
})

Deno.test('a space is near a ceiling at 80% and over it at 100%', () => {
  assertEquals(level(space(), 1, NOW), 'ok')
  assertEquals(level(space({ requests: 39_999 }), 1, NOW), 'ok')
  assertEquals(level(space({ requests: 40_000 }), 1, NOW), 'near')
  assertEquals(level(space({ requests: 50_000 }), 1, NOW), 'over')
  // Any of the four is enough, and the apps are counted, not metered.
  assertEquals(level(space(), 4, NOW), 'near')
  assertEquals(level(space(), 5, NOW), 'over')
  assertEquals(level(space({ emails: 81 }), 1, NOW), 'near')
  assertEquals(level(space({ bytes: FREE.bytes }), 1, NOW), 'over')
  // Last month's reading is not this month's usage.
  assertEquals(
    level(space({ month: '2026-08', requests: 60_000 }), 1, NOW),
    'ok',
  )
})

Deno.test('the line says every number against its ceiling', () => {
  let said = standing(
    space({ requests: 41_000, bytes: 900 * 1024 ** 2 }),
    3,
    NOW,
  )
  assertStringIncludes(said, '3 of 5 apps')
  assertStringIncludes(said, '41,000 of 50,000 requests')
  assertStringIncludes(said, '900 MB of 1 GB')
  assertStringIncludes(said, '0 of 100 emails')
  // The hour those figures were read: the meter is an hourly rollup, and a
  // bare number reads as live (C-32869 item 6).
  assertStringIncludes(said, '(as of 12:00 UTC)')
  assertStringIncludes(said, 'Requests are never refused')
})

Deno.test('before the first sweep the line says so, not zero', () => {
  let said = standing(space({ at: '' }), 1, NOW)
  assertStringIncludes(said, '1 of 5 apps')
  assertStringIncludes(said, 'have not been read yet')
  assert(!said.includes('of 50,000 requests'), 'it claimed a request count')
  assertStringIncludes(said, 'Requests are never refused')
})

Deno.test('a refusal names the ceiling and says a paid tier is coming', () => {
  for (let what of ['apps', 'bytes', 'emails'] as const) {
    let said = atCeiling(space(), what)
    assertStringIncludes(said, 'free tier')
    assertStringIncludes(said, 'A paid tier is coming.')
  }
  assertStringIncludes(atCeiling(space(), 'apps'), '5 apps')
})
