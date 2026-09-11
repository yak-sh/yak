import { assert, assertEquals } from '@std/assert'
import { agent } from './run.ts'
import { open } from './store.ts'
import { type Comp, transient } from '@yaks/graph'
import { ModelError } from '@yaks/model'
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
    model: (req) => {
      calls++
      req.onText?.({ index: 0, text: 'partial' })
      return Promise.reject(new ModelError('network', 'connection lost'))
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

Deno.test('a real worker transfers transient text before model completion', async () => {
  const { remote } = await import('./remote.ts')
  const a = await remote({
    db: ':memory:',
    streaming: true,
    fake: { delayMs: 300, deltas: 30 },
  })
  try {
    const id = await a.agent.start('stream')
    await a.agent.transcript(id)
    let partial = false
    const check = async () => {
      const rows = await a.agent.transcript(id)
      if (
        rows.some((b) => (b.attempt as Comp)?.state == 'inflight') &&
        rows.some((b) => (b.content as Comp)?.body == 'x'.repeat(30))
      ) partial = true
    }
    const off = a.subscribe(() => {
      void check()
    })
    await check()
    for (let end = Date.now() + 5000;;) {
      const current = await a.agent.transcript(id)
      if (current.some((b) => (b.attempt as Comp)?.state == 'completed')) break
      if (Date.now() > end) throw new Error('worker stream timed out')
      await new Promise((r) => setTimeout(r, 5))
    }
    off()
    const rows = await a.agent.transcript(id)
    assert(partial, 'replicated an in-flight text projection')
    assertEquals((rows.find((b) => b.ask)!.attempt as Comp).state, 'completed')
  } finally {
    await a.close()
  }
})

Deno.test('new input while streaming is outside frozen ask boundary and served in follow-up', async () => {
  const h = open(':memory:')
  let release!: () => void, started!: () => void, calls = 0
  const gate = new Promise<void>((r) => release = r)
  const sent = new Promise<void>((r) => started = r)
  const requests: import('@yaks/model').Request[] = []
  const a = agent({
    h,
    streaming: true,
    model: async (req) => {
      requests.push(req)
      if (++calls == 1) {
        started()
        await gate
      }
      return {
        id: String(calls),
        model: 'fake',
        items: [{ kind: 'assistant', text: 'done' }],
      }
    },
  })
  try {
    const id = await a.start('first')
    await sent
    await a.send(id, 'second')
    const before = await a.transcript(id)
    const ask = before.find((b) => b.ask)!
    assertEquals(
      (before.find((b) => b.entity.eid == (ask.ask as Comp).through)!
        .content as Comp).body,
      'first',
    )
    release()
    await a.idle(id)
    assertEquals(calls, 2)
    assert(
      !requests[0].items.some((i) => i.kind == 'user' && i.text == 'second'),
    )
    assert(
      requests[1].items.some((i) => i.kind == 'user' && i.text == 'second'),
    )
  } finally {
    release()
    await a.close()
  }
})

Deno.test('restart of dispatched attempt is interrupted, never resent', async () => {
  const h = open(':memory:')
  const a = agent({
    h,
    streaming: true,
    model: () => {
      throw new Error('must not dispatch')
    },
  })
  try {
    await h.g.apply([
      { entity: { eid: 'interrupted-session' }, session: {} },
      {
        entity: { eid: 'question' },
        entry: { session: 'interrupted-session' },
        content: { body: 'question' },
      },
      {
        entity: { eid: 'request' },
        entry: { session: 'interrupted-session' },
        ask: { through: 'question' },
        attempt: { state: 'inflight' },
      },
      {
        entity: { eid: 'partial' },
        entry: { session: 'interrupted-session' },
        content: { body: 'checkpoint', source: 'request' },
      },
    ], { trusted: true })
    await a.resume()
    await a.idle('interrupted-session')
    await a.resume()
    await a.idle('interrupted-session')
    const entries = await a.transcript('interrupted-session')
    assertEquals(entries.filter((b) => b.error).length, 1)
    assertEquals(entries.filter((b) => b.exception).length, 0)
    assertEquals(statusOf(entries), 'failed')
    assertEquals(
      (entries.find((b) => b.ask)!.attempt as Comp).state,
      'interrupted',
    )
    assertEquals(
      (entries.find((b) => b.entity.eid == 'partial')!.content as Comp).body,
      'checkpoint',
    )
  } finally {
    await a.close()
  }
})

Deno.test('fork admission cannot capture mutable in-flight output', async () => {
  const { assertRejects } = await import('@std/assert')
  const h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'parent' }, session: {} },
      {
        entity: { eid: 'request' },
        entry: { session: 'parent' },
        ask: {},
        attempt: { state: 'inflight' },
      },
      {
        entity: { eid: 'partial' },
        entry: { session: 'parent' },
        content: { body: '', source: 'request' },
      },
    ], { trusted: true })
    await assertRejects(
      async () => {
        await h.g.apply([{
          entity: { eid: 'child' },
          session: {},
          fork: { from: 'partial' },
        }], { trusted: true })
      },
      Error,
      'in-flight',
    )
    await h.g.apply([{
      entity: { eid: 'request' },
      attempt: { state: 'completed' },
    }], { trusted: true })
    await h.g.apply([{
      entity: { eid: 'child' },
      session: {},
      fork: { from: 'partial' },
    }], { trusted: true })
  } finally {
    h.close()
  }
})

Deno.test('an empty successful reply completes its ask rather than issuing another request', async () => {
  const h = open(':memory:')
  let count = 0
  const a = agent({
    h,
    streaming: true,
    model: () => {
      count++
      return Promise.resolve({ id: 'empty', model: 'fake', items: [] })
    },
  })
  try {
    const id = await a.start('hello')
    await a.idle(id)
    assertEquals(count, 1)
    assertEquals(statusOf(await a.transcript(id)), 'settled')
  } finally {
    await a.close()
  }
})

Deno.test('checkpoints bound blob versions and finalization persists one stable response', async () => {
  const h = open(':memory:')
  const initial =
    h.db.prepare('select count(*) as n from blob_text').get<{ n: number }>()!.n
  let appends = 0
  transient(h.g).subscribe((f) => {
    if (f.op == 'append') appends++
  })
  const a = agent({
    h,
    streaming: true,
    checkpointMs: 0,
    model: (req) => {
      for (let i = 0; i < 2000; i++) req.onText?.({ index: 0, text: 'chunk' })
      return Promise.resolve({
        id: 'r',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'chunk'.repeat(2000) }],
      })
    },
  })
  try {
    const id = await a.start('hello')
    await a.idle(id)
    const count =
      h.db.prepare('select count(*) as n from blob_text').get<{ n: number }>()!
        .n
    assertEquals(appends, 2000)
    assert(count - initial < 20, 'not one blob per delta')
  } finally {
    await a.close()
  }
})

Deno.test('operational interruption retains partial context, waits, and continues from completed anchor', async () => {
  const h = open(':memory:')
  const requests: import('@yaks/model').Request[] = []
  const model: import('@yaks/model').Model = (req) => {
    requests.push(req)
    if (requests.length == 2) {
      req.onText?.({ index: 0, text: 'That' })
      return Promise.reject(new DOMException('Stopped', 'AbortError'))
    }
    return Promise.resolve({
      id: 'r' + requests.length,
      model: 'fake',
      items: [{ kind: 'assistant' as const, text: 'okay' }],
    })
  }
  model.mark = (reply) => ({ openai: { response_id: reply.id } })
  model.anchor = (entry) =>
    (entry.openai as Comp | undefined)?.response_id as string | undefined
  const a = agent({ h, streaming: true, model })
  try {
    const id = await a.start('first')
    await a.idle(id)
    await a.send(id, 'second')
    await a.idle(id)
    let rows = await a.transcript(id)
    assertEquals(statusOf(rows), 'failed')
    assertEquals(rows.filter((b) => b.exception).length, 0)
    assertEquals(rows.filter((b) => b.error).length, 1)
    await a.resume()
    await a.resume()
    await a.idle(id)
    assertEquals(requests.length, 2)
    await a.send(id, 'continue')
    await a.idle(id)
    assertEquals(requests.length, 3)
    assertEquals(requests[2].anchor, 'r1')
    assert(
      requests[2].items.some((i) => i.kind == 'user' && i.text == 'second'),
    )
    assert(
      requests[2].items.some((i) => i.kind == 'assistant' && i.text == 'That'),
    )
    assert(
      requests[2].items.some((i) => i.kind == 'user' && i.text == 'continue'),
    )
    rows = await a.transcript(id)
    assertEquals(statusOf(rows), 'settled')
  } finally {
    await a.close()
  }
})

Deno.test('unexpected model programming failure remains an exception', async () => {
  const h = open(':memory:')
  const a = agent({
    h,
    streaming: true,
    model: () => {
      throw new TypeError('broken adapter')
    },
  })
  try {
    const id = await a.start('hello')
    await a.idle(id)
    const rows = await a.transcript(id)
    assertEquals(statusOf(rows), 'failed')
    assert(
      rows.some((b) =>
        b.exception &&
        String((b.content as Comp)?.body).includes('broken adapter')
      ),
    )
  } finally {
    await a.close()
  }
})

Deno.test('input admitted during an aborted turn is served once after interruption', async () => {
  const h = open(':memory:')
  let started!: () => void, abort!: () => void
  const entered = new Promise<void>((r) => started = r)
  const gate = new Promise<void>((r) => abort = r)
  const requests: import('@yaks/model').Request[] = []
  const a = agent({
    h,
    streaming: true,
    model: async (req) => {
      requests.push(req)
      if (requests.length == 1) {
        req.onText?.({ index: 0, text: 'partial' })
        started()
        await gate
        throw new DOMException('Stopped', 'AbortError')
      }
      return {
        id: 'continued',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'done' }],
      }
    },
  })
  try {
    const id = await a.start('first')
    await entered
    await a.send(id, 'correction')
    abort()
    await a.idle(id)
    assertEquals(requests.length, 2)
    assert(requests[1].items.some((i) => i.kind == 'user' && i.text == 'first'))
    assert(
      requests[1].items.some((i) => i.kind == 'user' && i.text == 'correction'),
    )
    assert(
      requests[1].items.some((i) =>
        i.kind == 'assistant' && i.text == 'partial'
      ),
    )
    assertEquals(statusOf(await a.transcript(id)), 'settled')
  } finally {
    abort()
    await a.close()
  }
})

Deno.test('invalid provider history records a healable exception, not an operational interruption', async () => {
  let { responses } = await import('@yaks/openai')
  let h = open(':memory:')
  let a = agent({
    h,
    streaming: true,
    model: responses({
      credential: () => ({ token: 'test', base: 'https://provider.invalid' }),
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                type: 'invalid_request_error',
                message: 'No tool output found for function call call_test',
              },
            }),
            { status: 400 },
          ),
        ),
    }),
  })
  try {
    let id = await a.start('hello')
    await a.idle(id)
    let rows = await a.transcript(id)
    assertEquals(statusOf(rows), 'failed')
    assert(
      rows.some((b) =>
        b.exception &&
        String((b.content as Comp)?.body).includes('No tool output found')
      ),
    )
  } finally {
    await a.close()
  }
})

Deno.test('provider rejection paints crashed and successful recovery clears it', async () => {
  let h = open(':memory:')
  let calls = 0
  let a = agent({
    h,
    streaming: true,
    model: () => {
      calls++
      return calls == 1
        ? Promise.reject(new ModelError('400', 'No tool output found'))
        : Promise.resolve({
          id: 'recovered',
          model: 'fake',
          items: [{ kind: 'assistant' as const, text: 'done' }],
        })
    },
  })
  try {
    let { resolve } = await import('@yaks/render')
    let { statusViews, statusVocab } = await import('./status.ts')
    let id = await a.start('hello')
    await a.idle(id)
    let check = async (status: string, color: string, title: string) => {
      let [row] = await h.g.read(`.session.status=${status}`)
      assertEquals(row?.entity.eid, id)
      assertEquals(statusOf(await a.transcript(id)), status)
      let renderer = resolve(statusViews, row, 'Indicator', statusVocab)!
      let node = renderer.render<{ props: Record<string, unknown> | null }>(
        row,
        (_tag, props) => ({ props }),
        {},
      )
      assertEquals(node.props?.class, color)
      assertEquals(node.props?.title, title)
    }
    await check('failed', 'Bad', 'Crashed')
    assertEquals(calls, 1)
    await a.send(id, 'continue')
    await a.idle(id)
    await check('settled', 'Good', 'Settled')
    assertEquals(calls, 2)
  } finally {
    await a.close()
  }
})
