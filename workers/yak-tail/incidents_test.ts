import { assertEquals, assertNotEquals } from '@std/assert'
import {
  COOLDOWN,
  type Event,
  type Fault,
  faults,
  normalise,
  PATIENCE,
  record,
  REPAGE,
  type Sample,
  signature,
} from './incidents.ts'

let sample = (overrides: Partial<Sample> = {}): Sample => ({
  name: 'TypeError',
  message: 'boot object 123 failed',
  stack:
    'TypeError: boot object 123 failed\n    at boot (graph.js:12:8)\n    at fetch (index.js:8:2)',
  entrypoint: 'Store',
  url: 'https://jeff.yaks.app/recipes',
  ...overrides,
})

for (
  let [a, b] of [
    ['object 123 at 456', 'object 987 at 654'],
    [
      'object 01234567-89ab-cdef-0123-456789abcdef',
      'object abcdefab-cdef-abcd-efab-cdefabcdefab',
    ],
    [
      'object aabbccddeeff00112233445566778899',
      'object ffeeddccbbaa99887766554433221100',
    ],
    ['object 01ARZ3NDEKTSV4RRFFQ69G5FAV', 'object 01BX5ZZKBKACTAV9WEVGEMMVS0'],
  ]
) {
  Deno.test(`normalise: ${a}`, () => assertEquals(normalise(a), normalise(b)))
}

Deno.test('signature keeps the cause, top frame and entrypoint, ignores ids and deeper frames', async () => {
  let a = await signature(sample())
  assertEquals(
    a,
    await signature(sample({
      message: 'boot object 987 failed',
      stack:
        'TypeError: boot object 987 failed\n    at boot (graph.js:12:8)\n    at another (other.js:2:1)',
      url: 'https://mom.yaks.app/recipe-box',
    })),
  )
  for (
    let changed of [
      { name: 'SyntaxError' },
      { message: 'missing table' },
      { stack: 'Error\n    at read (graph.js:12:8)' },
      { stack: 'Error\n    at boot (graph.js:94:2)' },
      { entrypoint: 'default' },
    ]
  ) assertNotEquals(a, await signature(sample(changed)))
})

let event = (overrides: Partial<Event> = {}): Event => ({
  scriptName: 'yak',
  entrypoint: 'Store',
  outcome: 'exception',
  eventTimestamp: 1000,
  scriptVersion: { id: 'version-a' },
  event: { request: { url: 'https://jeff.yaks.app/recipes' } },
  exceptions: [{ name: 'TypeError', message: 'boot object 123 failed' }],
  ...overrides,
})

Deno.test('exception outcomes on every kernel entrypoint, never dispatched apps', async () => {
  for (let entrypoint of ['Store', 'default', 'Identity', null]) {
    assertEquals((await faults(event({ entrypoint }))).length, 1)
  }
  assertEquals(
    await faults(
      event({ scriptName: 'some-app' }),
    ),
    [],
  )
  assertEquals(
    (await faults(event({ exceptions: [], event: null })))[0].sample.url,
    null,
  )
  assertEquals(
    (await faults(event({ exceptions: [] })))[0].sample.name,
    'exception',
  )
})

Deno.test('error logs only from Store/default; logged exceptions count once per invocation', async () => {
  let logs = [{
    level: 'error',
    message: ['TypeError: boot object 456 failed'],
  }]
  assertEquals((await faults(event({ logs }))).length, 1)
  for (let entrypoint of ['Store', 'default', null, '']) {
    assertEquals(
      (await faults(event({ outcome: 'ok', entrypoint, logs }))).length,
      1,
    )
  }
  assertEquals(
    await faults(event({ outcome: 'ok', entrypoint: 'Identity', logs })),
    [],
  )
  assertEquals(
    await faults(
      event({ outcome: 'ok', logs: [{ level: 'warn', message: ['oops'] }] }),
    ),
    [],
  )
  let [seen] = await faults(
    event({
      outcome: 'ok',
      logs: [{
        level: 'error',
        message: [{ name: 'TypeError', message: 'boot object 123 failed' }],
      }],
    }),
  )
  assertEquals(seen.sample.name, 'TypeError')
  assertEquals(seen.version, 'version-a')
})

Deno.test('a deploy reset is not a fault; a storage reset is one that waits for a repeat', async () => {
  let reset = (message: string) =>
    faults(event({ exceptions: [{ name: 'Error', message }], event: null }))
  assertEquals(
    await reset('Durable Object reset because its code was updated.'),
    [],
  )
  let storage =
    'Internal error in Durable Object storage caused object to be reset; reference = '
  let [a] = await reset(storage + 'vdjuhq6r10pn17vdf1drophk')
  let [b] = await reset(storage + 'k3m9x2p7q1w8e5r4t6y0u2i1')
  assertEquals(a.patience, PATIENCE)
  assertEquals(a.signature, b.signature)
  assertEquals((await faults(event()))[0].patience, undefined)
})

let fault = (at: number, version = 'version-a'): Fault => ({
  signature: 'sig',
  version,
  at,
  sample: sample(),
})

Deno.test('a patient fault pages on its second occurrence within the hour, never on a first', () => {
  let patient = (at: number, version = 'version-a'): Fault => ({
    ...fault(at, version),
    patience: PATIENCE,
  })
  let first = record(null, patient(0))
  assertEquals(first.page, false)
  let second = record(first.incident, patient(COOLDOWN - 1))
  assertEquals(second.page, true)
  assertEquals(second.incident.count, 2)
  assertEquals(record(second.incident, patient(2 * COOLDOWN - 2)).page, false)
  let chain = record(
    second.incident,
    patient(2 * COOLDOWN + PATIENCE, 'version-b'),
  )
  assertEquals(chain.page, false)
  assertEquals(chain.incident.count, 1)
  let late = record(null, patient(0)).incident
  assertEquals(record(late, patient(PATIENCE + 1)).page, false)
})

Deno.test('cooldown lasts until thirty quiet minutes, preserves first sample across deploys', () => {
  let first = record(null, fault(1000))
  assertEquals(first.page, true)
  let previous = first.incident
  for (let n = 1; n <= 10; n++) {
    let next = record(previous, fault(1000 + n * (COOLDOWN - 1), 'version-b'))
    assertEquals(next.page, false)
    assertEquals(next.incident.first, 1000)
    assertEquals(next.incident.version, 'version-a')
    previous = next.incident
  }
  assertEquals(previous.count, 11)
  let late = record(previous, fault(900))
  assertEquals(late.page, false)
  assertEquals(late.incident.last, previous.last)
  let fresh = record(
    late.incident,
    fault(previous.last + COOLDOWN, 'version-c'),
  )
  assertEquals(fresh.page, true)
  assertEquals(fresh.incident.count, 1)
  assertEquals(fresh.incident.version, 'version-c')
})

Deno.test('a signature recurring after the cooldown re-pages only across a deploy or a quiet day', () => {
  let hour = 60 * 60 * 1000
  let previous = record(null, fault(0)).incident
  for (let n = 1; n <= 16; n++) {
    let next = record(previous, fault(n * hour))
    assertEquals(next.page, false)
    assertEquals(next.incident.count, 1)
    assertEquals(next.incident.first, n * hour)
    previous = next.incident
  }
  assertEquals(record(previous, fault(17 * hour, 'version-b')).page, true)
  assertEquals(record(previous, fault(16 * hour + REPAGE)).page, true)
  assertEquals(record(previous, fault(16 * hour + REPAGE - 1)).page, false)
})
