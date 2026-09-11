// The suite has one kernel runtime: sharing must not share a directory,
// session key, code letter or app even when the tests use the SAME names.
import { assertEquals, assertNotEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, kernel, letters, seed, signIn } from './probe.ts'

slow(
  'parallel kernel leases isolate names, config and mail in one runtime',
  async () => {
    let [a, b] = await Promise.all([kernel(), kernel({ APEX: 'yaks.fyi' })])
    let stopped = false
    try {
      if (Deno.env.get('YAK_PROBE_HOST')) {
        assertEquals(typeof a.socket?.port, 'number')
        assertEquals(a.socket?.port, b.socket?.port)
      }
      assertNotEquals(a.secret, b.secret)
      let [alice, bob] = await Promise.all([
        seed(a, [{ slug: 'same', apps: ['notes'] }]),
        seed(b, [{ slug: 'same', apps: ['notes'] }]),
      ])
      let left = client(a, 'same.yaks.app', 'notes', alice.cookie)
      let right = client(b, 'same.yaks.fyi', 'notes', bob.cookie)
      await left.applied({ entities: [{ doc: { title: 'left only' } }] })
      assertEquals((await right.get('.title="left only"')).length, 0)
      let email = 'same-probe@example.test'
      await Promise.all([signIn(a, email), signIn(b, email)])
      assertEquals(letters(a, email).length, 1)
      assertEquals(letters(b, email).length, 1)
      await a.stop()
      stopped = true
      assertEquals((await right.get('.title="left only"')).length, 0)
    } finally {
      await Promise.all([stopped ? Promise.resolve() : a.stop(), b.stop()])
    }
  },
)
