import { assertEquals, assertThrows } from '@std/assert'
import { test } from '@yaks/testing'
import type { Config } from './config.ts'
import { dutyRoles, workerRoles } from './roles.ts'

test('duty roles preserve pooling, facet selection, missing exports and served roles', () => {
  let config: Config = {
    plugins: [
      '@yaks/one',
      { use: '@yaks/two', facets: ['vocab'] },
      { use: '@yaks/three', facets: ['service'] },
      '@yaks/absent',
    ],
  }
  let has = (p: string) => p != '@yaks/absent'
  assertEquals(dutyRoles(config, true, [], has), [
    'effects',
    '@yaks/one',
    '@yaks/three',
  ])
  assertEquals(dutyRoles(config, false, ['@yaks/one'], has), ['@yaks/three'])
  assertEquals(dutyRoles(config, true, ['effects'], has), [
    '@yaks/one',
    '@yaks/three',
  ])
})

test('configured workers separate mail without losing other duties', () => {
  let config: Config = {
    processes: [
      { unit: 'yak-work', except: ['@yaks/mail'] },
      { unit: 'yak-mail', roles: ['@yaks/mail'] },
    ],
  }
  let duties = ['effects', '@yaks/mail', '@yaks/session']
  assertEquals(workerRoles(config, duties, undefined, 'yak-work'), [
    'graph',
    'effects',
    '@yaks/session',
  ])
  assertEquals(workerRoles(config, duties, undefined, 'yak-mail'), [
    'graph',
    '@yaks/mail',
  ])
  assertEquals(workerRoles(config, duties), ['graph', ...duties])
  assertThrows(() => workerRoles(config, duties, undefined, 'typo'))
  assertThrows(() => workerRoles(config, duties, ['absent']))
})
