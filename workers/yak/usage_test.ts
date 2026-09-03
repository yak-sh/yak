// The meter's one seam that needs no runtime: an analytics answer read into
// rows by store name (usage.ts `read`). The fixture is a recorded answer,
// trimmed — the shape of
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
// (data.viewer.accounts[0].<dataset>[].dimensions/sum) with the Durable
// Object datasets documented at
// https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
// and the field names this account's own schema introspects to.
import { assertEquals, assertThrows } from '@std/assert'
import { read, size } from './usage.ts'

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
  assertEquals(size(1024 ** 3), '1.0 GB')
})
