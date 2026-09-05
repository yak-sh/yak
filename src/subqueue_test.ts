// The socket's serving ORDER: a burst is answered cheapest first, and an unsub
// cancels a sub nobody waits for. Run: deno test src/subqueue_test.ts
import { assertEquals } from '@std/assert'
import { db } from './live_db.ts'
import { cost, subqueue } from './subqueue.ts'
import { until } from './testing.ts'

// A queue over a recording serve: the list IS the order the socket saw.
let record = () => {
  let served: string[] = []
  let q = subqueue(db, (f) => {
    served.push(f.sub ? `sub:${String(f.sub)}` : `unsub:${String(f.unsub)}`)
  })
  let after = (n: number) =>
    until(() => served.length == n, { poll: 0, label: () => served.join() })
  return { served, push: q.push, after }
}

Deno.test('cost: an answer the vocabulary bounds is cheap, an open one is not', () => {
  assertEquals(cost(db, '.task!&.tally=task.status'), 0)
  assertEquals(cost(db, '.task!&.count!'), 0)
  assertEquals(cost(db, '.comment!&.tally=comment.target'), 1)
  assertEquals(cost(db, '.task!&.limit=50'), 1)
})

Deno.test('a burst is answered cheapest first, not in arrival order', async () => {
  let { served, push, after } = record()
  push({ sub: 'board', q: '.task!&.limit=50' })
  push({ sub: 'route', q: '.task!' })
  push({ sub: 'tally', q: '.task!&.tally=task.status' })
  await after(3)
  assertEquals(served, ['sub:tally', 'sub:board', 'sub:route'])
})

Deno.test('a re-subscribe keeps its order with itself', async () => {
  let { served, push, after } = record()
  push({ sub: 'b', q: '.task!&.limit=50' })
  push({ sub: 't', q: '.task!&.tally=task.status' })
  // Cheap, but the same sub as the frame already waiting: one conversation.
  push({ sub: 'b', q: '.task!&.tally=task.status' })
  await after(3)
  assertEquals(served, ['sub:t', 'sub:b', 'sub:b'])
})

Deno.test('an unsub cancels a sub still waiting', async () => {
  let { served, push, after } = record()
  push({ sub: 'board', q: '.task!&.limit=50' })
  push({ sub: 'gone', q: '.task!&.limit=50' })
  push({ unsub: 'gone' })
  await after(2)
  assertEquals(served, ['unsub:gone', 'sub:board'])
})
