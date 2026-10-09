// The in-memory runtime keeps a store's native storage alive for background
// work, just as a Durable Object retains its waitUntil context.
import { assertEquals, assertThrows } from '@std/assert'
import { test, until } from '@yaks/testing'
import { DIM } from './embedding.ts'
import { platform } from './testing.ts'

test('platform disposal waits for store work before releasing storage', async () => {
  let release!: () => void
  let gate = new Promise<void>((done) => release = done)
  let asked = 0
  let p = platform('probe', {
    AI: {
      gateway: () => ({ getUrl: () => Promise.resolve('') }),
      run: async (_model: string, input: unknown) => {
        asked++
        await gate
        return {
          data: (input as { text: string[] }).text.map(() =>
            Array.from({ length: DIM }, (_, i) => i == 0 ? 1 : 0)
          ),
        }
      },
    },
  })
  try {
    let name = 'ada/lifetime'
    let post = (path: string, body: unknown) =>
      p.object(name).fetch(
        new Request(`http://store${path}`, {
          method: 'POST',
          headers: {
            'x-store': name,
            'x-yak-role': 'owner',
            'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          },
          body: JSON.stringify(body),
        }),
      )
    assertEquals((await post('/vocab', {})).status, 200)
    // A text the model is owed: an app's store holds none until it writes one.
    let note = [{ entity: { eid: 'note' }, doc: { title: 'A note' } }]
    assertEquals((await post('/apply', note)).status, 200)
    await until(() => asked > 0)
    let { storage } = p.states.get(name)!
    p[Symbol.dispose]()
    // The request ended, but its deferred vector must still be able to land.
    assertEquals(storage.sql.exec('select 1 as alive').toArray(), [{
      alive: 1,
    }])
    release()
    await p[Symbol.asyncDispose]()
    assertThrows(
      () => storage.sql.exec('select 1'),
      Error,
      'storage is disposed',
    )
  } finally {
    release()
    await p[Symbol.asyncDispose]()
  }
})
