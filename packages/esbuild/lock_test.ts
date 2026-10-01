import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { lockfile, pins, wanted } from './lock.ts'

test('a lock the build writes is the lock the next build installs', () => {
  let ranges = { three: '^0.180.0', hono: '^4' }
  let versions = { three: '0.180.1', hono: '4.13.9', 'es-toolkit': '1.2.0' }
  let text = lockfile('game', ranges, versions)
  assertEquals(pins(text), versions)
  // The same ranges against it install exactly what it holds.
  assertEquals(wanted(ranges, pins(text)), versions)
  // npm reads it as its own: version 3, the root naming what was declared.
  let lock = JSON.parse(text)
  assertEquals(lock.lockfileVersion, 3)
  assertEquals(lock.packages[''].dependencies, ranges)
})

test('a range the lock no longer satisfies is resolved again', () => {
  let held = pins(
    lockfile(undefined, { three: '^0.180.0' }, { three: '0.180.1' }),
  )
  assertEquals(wanted({ three: '0.181.x' }, held), { three: '0.181.x' })
  assertEquals(wanted({ three: 'latest' }, held), { three: 'latest' })
})

test('old toolkit pins never become npm requests', () => {
  let old = lockfile('app', { '@yaks/client': 'platform' }, {
    '@yaks/client': '0.2.10',
    '@yaks/missing': '0.1.0',
    preact: '10.26.4',
  })
  assertEquals(pins(old), { preact: '10.26.4' })
  assertEquals(
    wanted({ preact: '^10' }, {
      '@yaks/client': '0.2.10',
      preact: '10.26.4',
    }),
    { preact: '10.26.4' },
  )
  assertThrows(
    () => wanted({ '@yaks/client': 'platform' }, {}),
    Error,
    'seed platform dependencies',
  )
  assertThrows(
    () => wanted({ preact: 'platform' }, {}),
    Error,
    'seed platform dependencies',
  )
})
