// Fixed store compositions survive unrelated app declarations in the isolate.
import { assertStrictEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { GIT_STORE, PLATFORM_STORE } from './door.ts'
import { shapeOf } from './graph.ts'

let fixed = [PLATFORM_STORE, GIT_STORE, 'cache/core'].map((name) =>
  [name, shapeOf(name, null)] as const
)
for (let i = 0; i < 17; i++) {
  shapeOf(
    'cache/app',
    JSON.stringify({
      $defs: {
        [`cache_item_${i}`]: { properties: { label: { type: 'string' } } },
      },
    }),
  )
}

test('fixed store shapes survive a burst of app vocabularies', () => {
  for (let [name, held] of fixed) {
    assertStrictEquals(shapeOf(name, null), held)
  }
})

test('an undeclared app and an empty declaration share one shape', () => {
  assertStrictEquals(shapeOf('cache/empty', '{}'), shapeOf('cache/core', null))
  assertStrictEquals(
    shapeOf('cache/deployed', '{"$defs":{}}'),
    shapeOf('cache/core', null),
  )
})
