import { equal, test } from '@yaks/testing'
import { scopedOutbox } from './outbox.ts'
import type { Bundle } from '@yaks/graph'
import type { OutboxStore, Pending } from '@yaks/sync'

let saved = new Map<string, Pending<Bundle[]>[]>()
let open = (scope: string): OutboxStore<Bundle[]> => ({
  load: () => Promise.resolve(saved.get(scope) ?? []),
  put: (entry) => {
    saved.set(scope, [...saved.get(scope) ?? [], entry])
    return Promise.resolve()
  },
  remove: () => Promise.resolve(),
})
let owner!: (id: string) => void
let identity = new Promise<string>((resolve) => {
  owner = resolve
})
let scopes: string[] = []
let delayed = scopedOutbox({
  endpoint: 'https://box.test/web/apply',
  owner: () => identity,
  open: (scope) => {
    scopes.push(scope)
    return open(scope)
  },
})
let loading = delayed.load()
let row: Pending<Bundle[]> = {
  key: 'outbox:first',
  state: 'pending',
  sent: [{ entity: { eid: 'first' }, doc: { title: 'precious' } }],
}
let putting = delayed.put(row)

test('browse waits for the authenticated owner before loading or saving intent', async () => {
  equal(scopes, [])
  owner('alice')
  equal(await loading, [])
  await putting
  equal(scopes, [JSON.stringify(['https://box.test/web/apply', '', 'alice'])])
})

test('browse reopens only the same endpoint, mount and authenticated owner queue', async () => {
  let queue = (endpoint: string, storage: string | undefined, owner: string) =>
    scopedOutbox({
      endpoint,
      storage,
      owner: () => Promise.resolve(owner),
      open,
    })
  equal(await queue('https://box.test/web/apply', undefined, 'alice').load(), [
    row,
  ])
  equal(await queue('https://box.test/web/apply', undefined, 'bob').load(), [])
  equal(
    await queue('https://box.test/other/apply', undefined, 'alice').load(),
    [],
  )
  equal(
    await queue('https://box.test/web/apply', 'another-app', 'alice').load(),
    [],
  )
})

test('browse does not open a durable queue for an unknown owner', async () => {
  let called = false
  let queue = scopedOutbox({
    endpoint: 'https://box.test/web/apply',
    owner: () => Promise.resolve(undefined),
    open: (scope) => {
      called = true
      return open(scope)
    },
  })
  let error = await queue.load().then(() => undefined, (error) => error)
  equal(error?.message, 'Cannot save writes without an authenticated owner')
  equal(called, false)
})

test('browse refuses to send a saved intent after a cookie account switch', async () => {
  let owner: string | undefined = 'alice'
  let queue = scopedOutbox({
    endpoint: 'https://box.test/web/apply',
    owner: () => Promise.resolve(owner),
    open,
  })
  await queue.load()
  await queue.assertOwner()
  owner = 'bob'
  let error = await queue.assertOwner().then(() => undefined, (error) => error)
  equal(
    error?.message,
    'The authenticated write owner changed; reload to switch accounts',
  )
  owner = undefined
  error = await queue.assertOwner().then(() => undefined, (error) => error)
  equal(
    error?.message,
    'The authenticated write owner changed; reload to switch accounts',
  )
  owner = 'alice'
  await queue.assertOwner()
})

test('an unavailable owner lookup keeps a scoped write unsent', async () => {
  let fail = false
  let queue = scopedOutbox({
    endpoint: 'https://box.test/web/apply',
    owner: () =>
      fail ? Promise.reject(new Error('offline')) : Promise.resolve('alice'),
    open,
  })
  await queue.load()
  fail = true
  let error = await queue.assertOwner().then(() => undefined, (error) => error)
  equal(error?.message, 'offline')
})

test('legacy intent is enrolled durably before removal and keeps its precondition', async () => {
  let events: string[] = []
  let source = new Map([['old-id', {
    at: 123,
    changes: [
      {
        eid: 'precious',
        name: 'doc',
        comp: { title: 'edited' },
        was: { title: 'hash' },
      },
    ],
  }]])
  let rows: Pending<Bundle[]>[] = []
  let options = {
    endpoint: 'https://box.test/web/apply',
    owner: () => Promise.resolve('alice'),
    open: () => ({
      load: () => Promise.resolve([...rows]),
      put: (entry: Pending<Bundle[]>) => {
        events.push('put')
        rows.push(entry)
        return Promise.resolve()
      },
      remove: () => Promise.resolve(),
    }),
    legacy: {
      load: () => Promise.resolve([...source]),
      remove: (key: string) => {
        events.push('remove')
        source.delete(key)
        return Promise.resolve()
      },
    },
  }
  let queue = scopedOutbox(options)
  let migrated = await queue.load()
  equal(events, ['put', 'remove'])
  equal(source.size, 0)
  equal(migrated[0], {
    key: 'outbox:old-id',
    state: 'pending',
    at: 123,
    sent: [{
      entity: { eid: 'precious' },
      doc: { title: 'edited' },
      $was: { doc: { title: 'hash' } },
    }],
  })
  equal(await scopedOutbox(options).load(), migrated)
  equal(events, ['put', 'remove'])
})

test('legacy intent is not removed when durable enrollment fails', async () => {
  let removed = false
  let queue = scopedOutbox({
    endpoint: 'https://box.test/web/apply',
    owner: () => Promise.resolve('alice'),
    open: () => ({
      load: () => Promise.resolve([]),
      put: () => Promise.reject(new Error('disk full')),
      remove: () => Promise.resolve(),
    }),
    legacy: {
      load: () => Promise.resolve([['old', { at: 1, changes: [] }]]),
      remove: () => {
        removed = true
        return Promise.resolve()
      },
    },
  })
  let error = await queue.load().then(() => undefined, (error) => error)
  equal(error?.message, 'disk full')
  equal(removed, false)
})

test('a failed source removal can resume without overwriting the enrolled refusal', async () => {
  let writes = 0
  let removes = 0
  let row: Pending<Bundle[]> = {
    key: 'outbox:old',
    state: 'refused',
    refusal: { name: 'Refused', message: 'moved' },
    sent: [{ entity: { eid: 'old' }, doc: { title: 'intent' } }],
  }
  let options = {
    endpoint: 'https://box.test/web/apply',
    owner: () => Promise.resolve('alice'),
    open: () => ({
      load: () => Promise.resolve([row]),
      put: () => {
        writes++
        return Promise.resolve()
      },
      remove: () => Promise.resolve(),
    }),
    legacy: {
      load: () =>
        Promise.resolve(
          [['old', {
            at: 1,
            changes: [{ eid: 'old', name: 'doc', comp: { title: 'intent' } }],
          }]] as [
            string,
            { at: number; changes: import('./types.ts').Change[] },
          ][],
        ),
      remove: () => {
        removes++
        return removes === 1
          ? Promise.reject(new Error('old disk failed'))
          : Promise.resolve()
      },
    },
  }
  let error = await scopedOutbox(options).load().then(
    () => undefined,
    (error) => error,
  )
  equal(error?.message, 'old disk failed')
  equal(await scopedOutbox(options).load(), [row])
  equal(writes, 0)
  equal(removes, 2)
})
