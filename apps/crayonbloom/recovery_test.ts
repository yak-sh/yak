import { browserDrafts } from '@yaks/draft/browser'
import type { Stash } from '@yaks/draft'
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { recovery } from './recovery.ts'

let base = 'https://fixture.test/studio'
let values = new Map([
  [
    'yaks:drafts:https://fixture.test/api/|person:draft:book:one:title',
    JSON.stringify({ text: '', over: 'Removed title', rev: 1 }),
  ],
])
let stash: Stash = {
  get length() {
    return values.size
  },
  key: (i) => [...values.keys()][i] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => void values.set(key, value),
  removeItem: (key) => void values.delete(key),
}

test('an intentionally empty offline field is restored without reseeding its old text', async () => {
  let { document } = parseHTML('<input name="title" value="Removed title">')
  let recovering = await recovery(
    (name, value) =>
      name == 'drafts' && !value
        ? Promise.resolve({ principal: 'person', drafts: [] })
        : new Promise(() => {}),
    (error) => {
      throw error
    },
    base,
    () =>
      Promise.resolve((client, scope, opts) =>
        browserDrafts(client, scope, { ...opts, stash })
      ),
  )
  try {
    let input = document.querySelector('input')!
    recovering.field(input, 'book:one:title')
    equal(input.value, '')
  } finally {
    recovering.close()
  }
})
