import { equal, ok, test } from '@yaks/testing'
import { browserDrafts } from './browser.ts'
import type { Stash } from './mod.ts'

let stash = (): Stash => {
  let values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}
let offline = {
  me: () => Promise.resolve({ person: null }),
  apply: () => new Promise<{ bundles: never[] }>(() => {}),
  subscribe: () => () => {},
}
let keep = (
  storage: Stash,
  by: string,
  text: string,
  scope = 'book-studio',
) => {
  let desk = browserDrafts(offline, scope, { by, stash: storage })
  desk.type('book:one:markdown', text)
  desk.close()
}

test('pending guest input survives sign-in, including text already pending as the person', () => {
  let storage = stash()
  keep(storage, 'guest', 'A guest paragraph.')
  keep(storage, 'person', 'A person paragraph.')
  let desk = browserDrafts(offline, 'book-studio', {
    by: 'person',
    recover: ['guest'],
    stash: storage,
  })
  try {
    let text = desk.text('book:one:markdown')
    ok(text.includes('A guest paragraph.'))
    ok(text.includes('A person paragraph.'))
    equal(
      storage.getItem('yaks:drafts:book-studio|guest:draft:book:one:markdown'),
      null,
    )
    ok(
      storage.getItem('yaks:drafts:book-studio|person:draft:book:one:markdown'),
    )
  } finally {
    desk.close()
  }
})

test('recovery never borrows another app or a previous signed-in person', () => {
  let storage = stash()
  keep(storage, 'guest', 'Private in another app.', 'other-app')
  keep(storage, 'former-person', 'Private to that person.')
  let desk = browserDrafts(offline, 'book-studio', {
    by: 'person',
    recover: ['guest'],
    stash: storage,
  })
  try {
    equal(desk.text('book:one:markdown'), '')
  } finally {
    desk.close()
  }
  equal(storage.length, 2)
})

test('a failed recovery write retains the guest copy', () => {
  let storage = stash(), reports: unknown[] = []
  keep(storage, 'guest', 'Do not lose these words.')
  let broken = {
    ...storage,
    get length() {
      return storage.length
    },
    setItem: () => {
      throw new Error('Storage full')
    },
  }
  let desk = browserDrafts(offline, 'book-studio', {
    by: 'person',
    recover: ['guest'],
    stash: broken,
    report: (error) => reports.push(error),
  })
  try {
    ok(reports.length)
    ok(
      storage.getItem('yaks:drafts:book-studio|guest:draft:book:one:markdown')
        ?.includes('Do not lose these words.'),
    )
  } finally {
    desk.close()
  }
})

test('reloaded empty edits are present drafts rather than absent fields', () => {
  let storage = stash()
  storage.setItem(
    'yaks:drafts:book-studio|person:draft:book:one:markdown',
    JSON.stringify({
      text: '',
      over: 'Removed paragraph.',
      rev: 1,
    }),
  )
  let desk = browserDrafts(offline, 'book-studio', {
    by: 'person',
    stash: storage,
  })
  try {
    equal(desk.has('book:two:markdown'), false)
    equal(desk.has('book:one:markdown'), true)
    equal(desk.text('book:one:markdown'), '')
  } finally {
    desk.close()
  }
})

test('failed target copy keeps Alice input private while fresh guest input can pass to Bob', () => {
  let storage = stash(), reports: unknown[] = []
  keep(storage, 'guest', 'Alice guest paragraph.')
  keep(storage, 'alice', 'Alice earlier paragraph.')
  let blocked = {
    ...storage,
    get length() {
      return storage.length
    },
    setItem: (key: string, value: string) => {
      if (key.startsWith('yaks:drafts:book-studio|alice:')) {
        throw new Error('Target write unavailable')
      }
      storage.setItem(key, value)
    },
  }
  let alice = browserDrafts(offline, 'book-studio', {
    by: 'alice',
    recover: ['guest'],
    stash: blocked,
    report: (error) => reports.push(error),
  })
  try {
    ok(alice.text('book:one:markdown').includes('Alice earlier paragraph.'))
    ok(reports.length)
  } finally {
    alice.close()
  }
  let guest = browserDrafts(offline, 'book-studio', {
    by: 'guest',
    stash: storage,
  })
  try {
    equal(guest.has('book:one:markdown'), false)
    guest.type('book:one:markdown', 'Bob fresh paragraph.')
  } finally {
    guest.close()
  }
  let bob = browserDrafts(offline, 'book-studio', {
    by: 'bob',
    recover: ['guest'],
    stash: storage,
  })
  try {
    equal(bob.text('book:one:markdown'), 'Bob fresh paragraph.')
  } finally {
    bob.close()
  }
  let again = browserDrafts(offline, 'book-studio', {
    by: 'alice',
    recover: ['later-guest-instrument'],
    stash: storage,
  })
  try {
    let text = again.text('book:one:markdown')
    ok(text.includes('Alice guest paragraph.'))
    ok(text.includes('Alice earlier paragraph.'))
    equal(text.includes('Bob'), false)
  } finally {
    again.close()
  }
})

test('guest handoff preserves an empty edit through another customer using the same field', () => {
  let storage = stash()
  storage.setItem(
    'yaks:drafts:book-studio|guest:draft:book:one:markdown',
    JSON.stringify({
      text: '',
      over: 'Alice removed this paragraph.',
      rev: 1,
    }),
  )
  keep(storage, 'alice', 'Alice removed this paragraph.')
  let alice = browserDrafts(offline, 'book-studio', {
    by: 'alice',
    recover: ['guest'],
    stash: storage,
  })
  equal(alice.has('book:one:markdown'), true)
  equal(alice.text('book:one:markdown'), '')
  alice.close()
  keep(storage, 'guest', 'Bob fresh input.')
  let bob = browserDrafts(offline, 'book-studio', {
    by: 'bob',
    recover: ['guest'],
    stash: storage,
  })
  equal(bob.text('book:one:markdown'), 'Bob fresh input.')
  bob.close()
  let again = browserDrafts(offline, 'book-studio', {
    by: 'alice',
    recover: ['later-guest-instrument'],
    stash: storage,
  })
  try {
    equal(again.has('book:one:markdown'), true)
    equal(again.text('book:one:markdown'), '')
  } finally {
    again.close()
  }
})
