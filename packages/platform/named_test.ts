import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { Dir } from './located.ts'
import { nameItem, nameSet, unnamed } from './named.ts'

// A directory holding one person's row.
let directory = (title: string) => {
  let me: Bundle = {
    entity: { eid: 'dana' },
    doc: { title },
    email: { address: 'dana@example.com' },
  }
  let dir: Dir = {
    read: () => [me],
    apply: (bundles) => {
      for (let b of bundles) {
        me = { ...me, ...b }
      }
    },
  }
  return dir
}

test('a title is no name when it is empty, an address or its front', () => {
  let at = 'ada@example.com'
  equal(
    [undefined, '', 'ada@example.com', 'ada', 'Ada', 'Ada Lovelace'].map((t) =>
      unnamed(t, at)
    ),
    [true, true, true, true, false, false],
  )
})

test('name_set keeps a supplied name even if it matches the fallback', async () => {
  let dir = directory('dana')
  equal(
    await nameItem(dir, 'dana'),
    'Their name is unknown. When they tell you their own name, keep it with name_set.',
  )
  let set = nameSet(() => dir, 'dana')
  equal(await set.run({ name: ' x@y.z ' }), 'Give their name, not an address.')
  equal(
    await set.run({ name: ' dana ' }),
    'Kept: they go by dana.',
  )
  equal(
    await nameItem(dir, 'dana'),
    'Their saved display name is "dana". Use it as their name.',
  )
})
