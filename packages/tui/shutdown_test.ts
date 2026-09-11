import { assertEquals, assertRejects } from '@std/assert'
import { shutdown } from './shutdown.ts'

Deno.test('first interrupt drains without forcing; second forces once', async () => {
  let release!: () => void
  let active = new Promise<void>((resolve) => release = resolve)
  let drains = 0, forces = 0
  let q = shutdown({
    drain: () => {
      drains++
      return active
    },
    force: () => {
      forces++
    },
  })
  q.interrupt()
  assertEquals(q.draining, true)
  await Promise.resolve()
  assertEquals(drains, 1)
  assertEquals(forces, 0)
  q.interrupt()
  await q.done
  q.interrupt()
  release()
  assertEquals(forces, 1)
})

Deno.test('drain completion exits without another key', async () => {
  let q = shutdown({ drain: () => Promise.resolve() })
  q.interrupt()
  await q.done
})

Deno.test('drain failure remains visible, but rejection after force is consumed', async () => {
  let q = shutdown({ drain: () => Promise.reject(new Error('drain broke')) })
  q.interrupt()
  await assertRejects(() => q.done, Error, 'drain broke')
  let reject!: (e: unknown) => void
  let pending = new Promise<void>((_, no) => reject = no)
  let forced = shutdown({ drain: () => pending })
  forced.interrupt()
  await Promise.resolve()
  forced.interrupt()
  await forced.done
  reject(new Error('worker gone'))
  await Promise.resolve()
})
