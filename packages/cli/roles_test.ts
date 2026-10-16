import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import type { Config } from './config.ts'
import { dutyRoles } from './roles.ts'

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
