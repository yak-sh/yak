// Cloudflare's runtime loads the reporting wrappers, including constructor,
// lifecycle and RPC methods, and retained sends reach the tracker's interface.
import { equal, test, until } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { workerd } from './probe.ts'

let samples = (log: string): Bundle[] =>
  Deno.readTextFileSync(log).split('\n')
    .filter((line) => line.startsWith('yak-tracker '))
    .flatMap((line) => JSON.parse(line.slice('yak-tracker '.length)))
    .filter((row) => row.error)

test('runtime gateway, construction, lifecycle and RPC failures reach tracker', async () => {
  let k = await workerd()
  let id = crypto.randomUUID()
  let before = samples(k.log).length
  let response = await fetch(`${k.base}/__defects/${id}`)
  equal(response.status, 500)
  await response.body?.cancel()
  await until(() => samples(k.log).length >= before + 4)
  let rows = samples(k.log).slice(before)
  equal(rows.map((row) => (row.exception as { value: string }).value).sort(), [
    'caught gateway failure',
    'caught object failure',
    'escaping RPC failure',
    'object construction failure',
  ])
  equal(
    (rows.find((row) =>
      (row.exception as { value: string }).value == 'caught gateway failure'
    )!.error as { tags: { request_id: string } }).tags.request_id,
    id,
  )
})

test('an interrupted store upload keeps no rows or writes and reports no failure', async () => {
  let k = await workerd()
  let before = samples(k.log).length
  let response = await fetch(
    `${k.base}/__defects/upload/${crypto.randomUUID()}`,
  )
  equal(await response.json(), {
    statuses: [400, 400, 400],
    rows: [],
    writes: [],
  })
  equal(samples(k.log).length, before)
})

test('a store alarm cut off by the runtime is reported once by its retry', async () => {
  let k = await workerd()
  let before = samples(k.log).length
  let response = await fetch(`${k.base}/__defects/alarm/${crypto.randomUUID()}`)
  equal(await response.json(), { retried: true })
  await until(() => samples(k.log).length > before)
  equal(
    samples(k.log).slice(before).map((row) =>
      (row.error as { tags: unknown }).tags
    ),
    [{
      request: 'alarm',
      store: 'ada/notes',
      retry: '1',
      script: 'yak',
      version: 'unknown',
      entrypoint: 'store probe',
    }],
  )
})
