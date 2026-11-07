// A store's start holds every request that arrives before it finishes, and
// each says so; a start that took a second or more says so in the log.
import { equal, ok, test } from '@yaks/testing'
import { Store } from './graph.ts'
import { state } from './testing.ts'

const headers = {
  'x-store': 'ada/held',
  'x-yak-access': 'private',
  'x-yak-role': 'owner',
  'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
}

let read = (store: Store) =>
  store.fetch(
    new Request('http://store/query', {
      method: 'POST',
      headers,
      body: JSON.stringify({ q: '.doc' }),
    }),
  )

test('a request held by a start already under way says how long it waited, and a slow start is logged', async () => {
  let ctx = state()
  using _db = ctx.storage
  // The start's first read waits until the test lets it go, a second and a
  // half later on the store's clock.
  let now = 0, open!: () => void
  let gate = new Promise<void>((r) => open = r)
  let get = ctx.storage.get.bind(ctx.storage)
  ctx.storage.get = (async (key: string) => {
    if (key == 'expires') await gate
    return get(key)
  }) as typeof ctx.storage.get
  let store = new Store(ctx, {}, undefined, { now: () => now })
  let logged: string[] = []
  let log = console.log
  console.log = (...said: unknown[]) => void logged.push(said.join(' '))
  try {
    let first = read(store)
    await new Promise((r) => setTimeout(r, 0))
    let behind = read(store)
    await new Promise((r) => setTimeout(r, 0))
    now = 1500
    open()
    equal((await first).headers.get('x-yak-wake'), '1500')
    equal((await behind).headers.get('x-yak-wake'), '1500')
    equal((await read(store)).headers.get('x-yak-wake'), null)
  } finally {
    console.log = log
  }
  ok(logged.includes('yak store slow {"store":"ada/held","start":1500}'))
})
