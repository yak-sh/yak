// The platform's scoped SDK events enter the shared reporter and durable intake.
import { equal, ok, test } from '@yaks/testing'
import { ServerRuntimeClient, setCurrentClient } from '@sentry/core'
import type { Bundle } from '@yaks/graph'
import { Refused } from '@yaks/graph'
import type { WindowClock } from '@yaks/tracker/report'
import type { SentryEvent } from '@yaks/tracker/sentry'
import { batch } from '../tracker/queue.ts'
import { platform } from '../tracker/core.ts'
import { caught, defect, delivery, options, sample } from './sentry.ts'

let clock = () => {
  let run: (() => Promise<void>) | undefined
  return {
    now: () => 0,
    after: (_ms, next) => {
      run = next
      return () => {}
    },
    flush: () => run?.(),
  } satisfies WindowClock & { flush: () => Promise<void> | undefined }
}
let event = (message = 'storm') =>
  sample({
    type: undefined,
    tags: { space: 'throwaway', app: 'probe', request_id: 'request' },
    exception: { values: [{ type: 'TypeError', value: message }] },
  })

test('platform storms use the same samples and hits for Sentry and tracker', async () => {
  let queued: Bundle[][] = []
  let sent: SentryEvent[] = []
  let time = clock()
  let sink = delivery({
    ERRORS: {
      send: (rows) => {
        queued.push(rows)
        return Promise.resolve()
      },
    },
    SENTRY_DSN: 'configured',
  }, (event) => {
    sent.push(event)
    return Promise.resolve()
  }, time)
  for (let i = 0; i < 7; i++) await sink(event())
  equal(queued.length, 1)
  await time.flush()
  equal(queued.length, 2)
  equal(sent.map((e) => e.extra?.hits), [1, 6])
  equal(
    queued.map((rows) => (rows[0].error as { hits?: number }).hits ?? 1),
    [1, 6],
  )
  for (let rows of queued) {
    equal(batch(rows).scope, platform)
    equal(rows[0].during, undefined)
    equal((rows[0].error as { tags: unknown }).tags, {
      space: 'throwaway',
      app: 'probe',
      request_id: 'request',
    })
  }
  equal(sent[0].fingerprint, sent[1].fingerprint)
})

test('Sentry quota failure leaves tracker samples and repeat hits intact', async () => {
  let queued: Bundle[][] = []
  let sink = delivery(
    {
      ERRORS: {
        send: (rows) => {
          queued.push(rows)
          return Promise.resolve()
        },
      },
      SENTRY_DSN: 'configured',
    },
    () => Promise.reject(Error('Sentry quota exhausted')),
    clock(),
  )
  await sink(event())
  await sink(event())
  await sink.close()
  equal(queued.length, 2)
  equal(batch(queued[1]).scope, platform)
})

test('SDK catches collect into the queue without a Sentry DSN and omit refusals', async () => {
  let queued: Bundle[][] = []
  let time = clock()
  let configured = options({
    ERRORS: {
      send: (rows) => {
        queued.push(rows)
        return Promise.resolve()
      },
    },
  }, time)
  let processed = Promise.withResolvers<void>()
  let captures = 0
  let client = new ServerRuntimeClient({
    ...configured,
    beforeSend: async (event, hint) => {
      let result = await configured.beforeSend(event, hint)
      if (++captures == 4) processed.resolve()
      return result
    },
    integrations: [],
    normalizeDepth: 0,
    stackParser: () => [],
  })
  setCurrentClient(client)
  client.init()
  for (let i = 0; i < 4; i++) {
    let error = Object.assign(new TypeError('queue without Sentry'), {
      stack: 'TypeError: queue without Sentry\n    at probe (probe.ts:1:1)',
    })
    caught(new Refused('no'), {})
    defect(error, { space: 'probe' })
    caught(error, { request: 'outer catch' })
  }
  await processed.promise
  equal(queued.length, 1)
  await time.flush()
  equal(queued.length, 2)
  equal((queued[1][0].error as { hits: number }).hits, 3)
  ok(queued.every((rows) => batch(rows).scope == platform))
})
