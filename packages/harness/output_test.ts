import { assert, assertEquals, assertRejects } from '@std/assert'
import { outputView } from '@yaks/context'
import { valueTools } from '@yaks/blob'
import { open } from './store.ts'
import { agent } from './run.ts'
import { harnessTools } from './tools.ts'
import type { Request } from '@yaks/model'

Deno.test('large outputs snapshot transparently, survive reopen and source mutation', async () => {
  const dir = Deno.makeTempDirSync()
  const path = dir + '/test.db'
  let h = open(path)
  try {
    const text = ('line 😀 needle\n').repeat(10000)
    await h.g.apply([{ entity: { eid: 'result' }, content: { body: text } }])
    const entry = (await h.g.read('.entity.eid=result'))[0]
    const stub = await outputView(h.g, entry)
    assert(stub.length < 2000)
    const handle = stub.match(/Handle: (.+)/)![1]
    const revision = stub.match(/Expected revision: ([a-f0-9]+)/)![1]
    assertEquals(await outputView(h.g, entry), stub)
    assertEquals((await h.g.read('.context_output')).length, 1)
    await h.g.apply([{ entity: { eid: 'result' }, content: { body: 'newer' } }])
    h.close()
    h = open(path)
    const [read, search] = valueTools(async (id) =>
      (await h.g.read('.entity.eid=' + JSON.stringify(id)))[0]
    )
    const args = {
      entity: handle,
      component: 'context_output',
      property: 'body',
      revision,
    }
    let recovered = '', start = 0
    while (true) {
      const slice = JSON.parse(await read.run({ ...args, start, count: 8192 }))
      recovered += slice.text
      if (slice.next == null) break
      start = slice.next
    }
    assertEquals(recovered, text)
    const matches = JSON.parse(
      await search.run({ ...args, query: 'needle', limit: 2 }),
    )
    assertEquals(matches.matches.map((m: { offset: number }) => m.offset), [
      7,
      21,
    ])
    await assertRejects(() => read.run({ ...args, count: 8193 }))
    await assertRejects(() => read.run({ ...args, start: -1 }))
    await assertRejects(() => read.run({ ...args, revision: 'wrong' }))
    await assertRejects(() => search.run({ ...args, query: '' }))
    assertEquals(
      await outputView(h.g, {
        entity: { eid: 'small' },
        content: { body: 'small 😀' },
      }),
      'small 😀',
    )
  } finally {
    h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('generic text inspection reads doc and content with reader authorization', async () => {
  const h = open(':memory:')
  try {
    await h.g.apply([{
      entity: { eid: 'note' },
      doc: { body: '😀hello\nworld' },
      content: { body: 'content' },
    }])
    const [read] = valueTools(async (id) =>
      id == 'note' ? (await h.g.read('.entity.eid=note'))[0] : undefined
    )
    const args = {
      entity: 'note',
      component: 'doc',
      property: 'body',
      start: 1,
      count: 5,
    }
    assertEquals(JSON.parse(await read.run(args)).text, 'hello')
    assertEquals(
      JSON.parse(await read.run({ ...args, component: 'content', start: 0 }))
        .text,
      'conte',
    )
    await assertRejects(() => read.run({ ...args, entity: 'forbidden' }))
    await assertRejects(() => read.run({ ...args, property: '__proto__' }))
  } finally {
    h.close()
  }
})

Deno.test('model receives bounded tool result, UI keeps original and prompt/user stay intact', async () => {
  const h = open(':memory:')
  const requests: Request[] = []
  const text = 'TOOL '.repeat(30000)
  const user = 'USER '.repeat(4000)
  const a = agent({
    h,
    name: 'fake',
    tools: [...harnessTools(h.g), {
      name: 'large',
      description: 'test',
      parameters: { type: 'object' },
      run: () => text,
    }],
    model: (req) => {
      requests.push(req)
      return Promise.resolve({
        id: 'r' + requests.length,
        model: 'fake',
        items: requests.length == 1
          ? [{
            kind: 'call' as const,
            id: 'call-large',
            name: 'large',
            args: '{}',
          }]
          : [{ kind: 'assistant' as const, text: 'done' }],
      })
    },
  })
  try {
    const id = await a.start(user)
    await a.idle(id)
    const sent = requests[1].items.find((i) => i.kind == 'result')
    assert(sent?.kind == 'result')
    assert(sent.output.length < 2000)
    assert(sent.output.includes('graph_value_read'))
    assertEquals(requests[0].items.find((i) => i.kind == 'user')?.text, user)
    const entries = await a.transcript(id)
    assertEquals(
      (entries.find((b) => b.result)?.content as { body: string }).body,
      text,
    )
  } finally {
    await a.close()
  }
})

Deno.test('fork projections reuse snapshots and escaped reads stay bounded', async () => {
  const h = open(':memory:')
  try {
    const text = '😀'.repeat(20000)
    await h.g.apply([
      { entity: { eid: 'parent' }, session: {} },
      {
        entity: { eid: 'result' },
        entry: { session: 'parent', seq: 1 },
        content: { body: text },
      },
      { entity: { eid: 'child' }, session: {}, fork: { from: 'result' } },
    ])
    const { transcript } = await import('@yaks/session')
    const parent = await transcript(h.g, 'parent')
    const child = await transcript(h.g, 'child')
    assertEquals(
      await outputView(h.g, child[0]),
      await outputView(h.g, parent[0]),
    )
    const snapshots = await h.g.read('.context_output')
    assertEquals(snapshots.length, 1)
    assertEquals((snapshots[0].context_output as { body: string }).body, text)
    const [read] = valueTools(async (id) =>
      (await h.g.read('.entity.eid=' + JSON.stringify(id)))[0]
    )
    await h.g.apply([{
      entity: { eid: 'escapes' },
      content: { body: '\t'.repeat(20000) },
    }])
    const reply = await read.run({
      entity: 'escapes',
      component: 'content',
      property: 'body',
      count: 8192,
    })
    assert(reply.length < 16384)
    assert(JSON.parse(reply).next > 0)
  } finally {
    h.close()
  }
})
