// A caught defect must leave the workerd invocation through the SDK wrapper's
// waitUntil flush. The probe's DSN is a local capture endpoint, never Sentry.
import { assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { workerd } from './probe.ts'

let events = async (log: string) =>
  (await Deno.readTextFile(log)).split('\n')
    .filter((line) => line.startsWith('yak-sentry '))
    .flatMap((line) => {
      let body: string = JSON.parse(line.slice('yak-sentry '.length))
      let parts = body.split('\n')
      return JSON.parse(parts[1]).type == 'event' ? [JSON.parse(parts[2])] : []
    })

// An envelope leaves in the wrapper's waitUntil, after the response, from the
// run's one workerd, which every workerd test file shares at once: it waits
// behind whatever the others have that process doing, as the socket tests'
// frames do (socket_workerd_test.ts), not the bound of an idle process.
let SENT = 15_000

test('a caught 500 reaches Sentry through the workerd wrapper', async () => {
  let k = workerd()
  let id = crypto.randomUUID()
  let response = await fetch(`${k.base}/__sentry/${id}`)
  assertEquals(response.status, 500)
  assertEquals(await response.text(), 'caught')
  let event = await until(
    async () =>
      (await events(k.log)).find((event) => event.tags?.request_id == id),
    {
      label: 'caught defect envelope',
      timeout: SENT,
    },
  )
  assertEquals(event.tags.request_id, id)
  assertEquals(event.exception.values[0].value, 'sentry probe')
})

test('a caught Durable Object failure reaches Sentry', async () => {
  let k = workerd()
  let id = crypto.randomUUID()
  let response = await fetch(`${k.base}/__sentry/do/${id}`)
  assertEquals(response.status, 500)
  assertEquals(await response.text(), 'caught in object')
  let event = await until(
    async () =>
      (await events(k.log)).find((event) => event.tags?.request_id == id),
    {
      label: 'Durable Object defect envelope',
      timeout: SENT,
    },
  )
  assertEquals(event.tags.request, 'GET /query')
  assertEquals(event.exception.values[0].value, 'durable object sentry probe')
})

test('a repeat window flushes its hits after the originating invocation responds', async () => {
  let k = workerd()
  let id = crypto.randomUUID()
  let response = await fetch(`${k.base}/__sentry/repeats/${id}`)
  assertEquals(response.status, 500)
  await response.body?.cancel()
  let samples = await until(async () => {
    let found = (await events(k.log)).filter((event) =>
      event.tags?.request_id == id
    )
    return found.length == 2 ? found : undefined
  }, { label: 'coalesced repeat envelope', timeout: SENT })
  assertEquals(samples.map((event) => event.extra.hits), [1, 4])
})

test('one thrown object counts once per invocation when later requests reuse it', async () => {
  let k = workerd()
  let id = crypto.randomUUID()
  for (let i = 0; i < 3; i++) {
    let response = await fetch(`${k.base}/__sentry/reused/${id}`)
    assertEquals(response.status, 500)
    await response.body?.cancel()
  }
  let samples = await until(async () => {
    let found = (await events(k.log)).filter((event) =>
      event.tags?.request_id == id
    )
    return found.length == 2 ? found : undefined
  }, { label: 'reused error occurrences', timeout: SENT })
  assertEquals(samples.map((event) => event.extra.hits), [1, 2])
})

test('the kernel sends a caught failure through its deployed wrapper', async () => {
  let k = workerd()
  let host = `sentry-probe-${crypto.randomUUID()}.example`
  let response = await k.at(host, '/')
  assertEquals(response.status, 503)
  await response.body?.cancel()
  let event = await until(
    async () =>
      (await events(k.log)).find((event) =>
        event.exception?.values?.[0].value == `cloudflare: sentry probe ${host}`
      ),
    { label: 'kernel caught defect envelope', timeout: SENT },
  )
  assertEquals(event.tags.request, 'domain settling')
  assertEquals(
    event.exception.values[0].value,
    `cloudflare: sentry probe ${host}`,
  )
})
