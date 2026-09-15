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
    served.push(
      f.sub
        ? `sub:${String(f.sub)}`
        : f.unsub
        ? `unsub:${String(f.unsub)}`
        : 'join',
    )
  })
  let after = (n: number) =>
    until(() => served.length == n, { poll: 0, label: () => served.join() })
  return { served, push: q.push, after }
}

Deno.test('cost: an answer the vocabulary bounds is cheap, an open one is not', () => {
  assertEquals(cost(db, '.task!&.tally=task.status'), 1)
  assertEquals(cost(db, '.task!&.count!'), 1)
  assertEquals(cost(db, '.comment!&.tally=comment.target'), 2)
  assertEquals(cost(db, '.task!&.limit=50'), 2)
})

Deno.test('cost: a sub about the seeded entity comes before everything', () => {
  assertEquals(cost(db, 'id=e1', 'route:e1', 'e1'), 0)
  assertEquals(cost(db, '.comment.target=e1', 'q:x', 'e1'), 0)
  assertEquals(cost(db, '.task!&.tally=task.status', 'tally:b', 'e1'), 1)
  assertEquals(cost(db, 'id=e2', 'route:e2', 'e1'), 2)
})

Deno.test('the page the socket booted on is answered before the shell', async () => {
  let { served, push, after } = record()
  push({ since: 0, seed: 'e1' })
  push({ sub: 'tray', q: '.session!&.session.status=running' })
  push({ sub: 'tally', q: '.task!&.tally=task.status' })
  push({ sub: 'route:e1', q: 'id=e1' })
  await after(4)
  assertEquals(served, ['join', 'sub:route:e1', 'sub:tally', 'sub:tray'])
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

Deno.test('cancelling the last queued ask during the hop keeps the socket usable', async () => {
  let { served, push, after } = record()
  push({ sub: 'gone', q: '.task!' })
  push({ unsub: 'gone' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assertEquals(served, ['unsub:gone'])
  push({ sub: 'next', q: '.task!' })
  await after(2)
  assertEquals(served, ['unsub:gone', 'sub:next'])
})
