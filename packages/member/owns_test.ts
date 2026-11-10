import { equal, test } from '@yaks/testing'
import { owns } from './owns.ts'

test('a fresh directory browser claim recovers only unbylined work for its person', () => {
  equal(
    owns({ via: 'old-a' }, { by: 'a', via: 'fresh-a', browsers: ['old-a'] }),
    true,
  )
  equal(
    owns({ via: 'old-a' }, { by: 'b', via: 'fresh-b', browsers: ['old-b'] }),
    false,
  )
  equal(
    owns({ by: 'a', via: 'old-b' }, {
      by: 'b',
      via: 'old-b',
      browsers: ['old-b'],
    }),
    false,
  )
  equal(owns({ via: 'old-a' }, { via: 'fresh-b', browsers: ['old-a'] }), false)
})

test('a signed-in caller cannot reuse an earlier credential whose instrument belongs to another person', () => {
  equal(owns({ via: 'old-a' }, { by: 'b', via: 'old-a', browsers: [] }), false)
  equal(owns({ via: 'guest' }, { via: 'guest' }), true)
  equal(owns({ by: 'a' }, { by: 'a', browsers: [] }), true)
})
