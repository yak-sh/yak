import { assert, assertEquals } from '@std/assert'
import { agent } from './run.ts'
import { open } from './store.ts'
import { type Comp, transient } from '@yaks/graph'
import { statusOf } from '@yaks/session'

Deno.test('streaming records ask before dispatch, projects text without durable token writes, and finalizes same entry', async () => {
  const h = open(':memory:')
  let release!: () => void, started!: () => void
  const gate = new Promise<void>((r) => release = r)
  const sent = new Promise<void>((r) => started = r)
  let writes = 0
  h.g.use({
    name: 'count',
    hooks: {
      effect: (b) => {
        writes++
        return b
      },
    },
  })
  const frames: import('@yaks/graph').TransientFrame[] = []
  transient(h.g).subscribe((f) => frames.push(f))
  const a = agent({
    h,
    streaming: true,
    model: async (req) => {
      const asks = await h.g.read('.ask')
      assertEquals(asks.length, 1)
      assertEquals((asks[0].attempt as Comp).state, 'inflight')
      started()
      for (let n = 0; n < 100; n++) req.onText?.({ index: 0, text: 'x' })
      await gate
      return {
        id: 'r',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'x'.repeat(100) }],
      }
    },
  })
  try {
    const id = await a.start('hello')
    await sent
    // Wait on the observable frame, not guessed scheduler time.
    if (frames.filter((f) => f.op == 'append').length < 100) {
      await new Promise<void>((r) => {
        const off = transient(h.g).subscribe(() => {
          if (
            frames.filter((f) => f.op == 'append').length == 100
          ) {
            off()
            r()
          }
        })
      })
    }
    const before = writes
    const entries = await a.transcript(id)
    assertEquals(statusOf(entries), 'running')
    const output = entries.find((b) => (b.content as Comp)?.source)
    assert(output)
    assertEquals((output.content as Comp).body, 'x'.repeat(100))
    const [raw] = await h.g.storage.tx((tx) => tx.get([output.entity.eid]))
    assertEquals((raw.content as Comp).body, '')
    release()
    await a.idle(id)
    const final = await a.transcript(id)
    assertEquals(final.filter((b) => (b.content as Comp)?.source).length, 1)
    assertEquals((final.find((b) => b.ask)!.attempt as Comp).state, 'completed')
    assertEquals(statusOf(final), 'settled')
    assert(writes - before < 10)
    assertEquals(transient(h.g).snapshots(), [])
  } finally {
    release()
    await a.close()
  }
})

Deno.test('partial failure preserves text and does not automatically retry ambiguous request', async () => {
  const h = open(':memory:')
  let calls = 0
  const a = agent({
    h,
    streaming: true,
    model: async (req) => {
      calls++
      req.onText?.({ index: 0, text: 'partial' })
      throw new Error('connection lost')
    },
  })
  try {
    const id = await a.start('hello')
    await a.idle(id)
    const entries = await a.transcript(id)
    assertEquals(calls, 1)
    assertEquals(statusOf(entries), 'failed')
    assertEquals(
      (entries.find((b) => b.ask)!.attempt as Comp).state,
      'interrupted',
    )
    assertEquals(
      (entries.find((b) => (b.content as Comp)?.source)!.content as Comp).body,
      'partial',
    )
  } finally {
    await a.close()
  }
})
