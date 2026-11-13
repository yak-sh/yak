import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { hostable, linked, upstreamOf } from './upstream.ts'

test('a permissive licence, by SPDX id or its usual name, allows a hosted copy', () => {
  let said = (l?: string) => [l, hostable(l)]
  assertEquals(
    ['MIT', 'MIT License', 'Apache-2.0', 'Apache License 2.0', 'BSD-3-Clause']
      .map(said),
    ['MIT', 'MIT License', 'Apache-2.0', 'Apache License 2.0', 'BSD-3-Clause']
      .map((l) => [l, true]),
  )
  assertEquals(
    [undefined, '', 'GPL-3.0', 'All rights reserved', 'CC-BY-NC-4.0'].map(said),
    [undefined, '', 'GPL-3.0', 'All rights reserved', 'CC-BY-NC-4.0'].map(
      (l) => [l, false],
    ),
  )
})

test('only something someone else wrote, under no copyable licence, is a link', () => {
  let up = (licence?: string) => ({
    upstream: upstreamOf({ source: 'https://x.test/s', licence }),
  })
  assertEquals([linked({ upstream: null }), linked(up('MIT')), linked(up())], [
    false,
    false,
    true,
  ])
  assertEquals(upstreamOf({ source: '', author: 'A' }), null)
})
