import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { Dir } from './located.ts'
import { nameItem, nameSet, unnamed } from './named.ts'

// A directory holding one person's row.
let directory = (title: string) => {
  let me: Bundle = {
    entity: { eid: 'erik' },
    doc: { title },
    email: { address: 'thecompanygardener@gmail.com' },
  }
  let dir: Dir = {
    read: () => [me],
    apply: (bundles) => {
      for (let b of bundles) {
        me = { ...me, doc: { ...me.doc as object, ...b.doc as object } }
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

test('the Operator is told it lacks their name until name_set keeps it', async () => {
  let dir = directory('thecompanygardener')
  equal(
    await nameItem(dir, 'erik'),
    "You don't know the name of the person you are talking with: their " +
      'account calls them thecompanygardener. When they say their name or ' +
      'sign with one, keep it with name_set.',
  )
  let set = nameSet(() => dir, 'erik')
  equal(await set.run({ name: ' x@y.z ' }), 'Give their name, not an address.')
  equal(await set.run({ name: ' Erik Unruh ' }), 'Kept: they go by Erik Unruh.')
  equal(await nameItem(dir, 'erik'), undefined)
})
