import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { outputView } from '@yaks/context'
import { valueRange, valueSearch, valueTools } from '@yaks/blob'
import { transcript } from '@yaks/session'
import { local } from './local.ts'
import { harnessTools } from './tools.ts'
import type { Request } from '@yaks/model'
import { harness } from './testing.ts'

test('large outputs snapshot transparently, survive reopen and source mutation', async () => {
  const dir = Deno.makeTempDirSync()
  const path = dir + '/test.db'
  let h = await harness(path)
  try {
    const text = ('line 😀 needle\n').repeat(10000)
    await h.g.apply([{ entity: { eid: 'result' }, content: { body: text } }])
    const entry = (await h.g.read('.entity.eid=result&*'))[0]
    const stub = await outputView(h.g, entry)
    assert(stub.length < 2000)
    const handle = stub.match(/Handle: (.+)/)![1]
    const revision = stub.match(/Expected revision: ([a-f0-9]+)/)![1]
    assertEquals(await outputView(h.g, entry), stub)
    assertEquals((await h.g.read('.context_output&*')).length, 1)
    await h.g.apply([{ entity: { eid: 'result' }, content: { body: 'newer' } }])
    h.close()
    h = await harness(path)
    const reader = async (id: string) =>
      (await h.g.read('.entity.eid=' + JSON.stringify(id)))[0]
    const read = valueRange(reader)
    const search = valueSearch(reader)
    const args = {
      entity: handle,
      component: 'context_output',
      property: 'body',
      revision,
    }
    let recovered = '', start = 0
    while (true) {
      const slice = await read({ ...args, start, count: 8192 })
      recovered += slice.text
      if (slice.next == null) break
      start = slice.next
    }
    assertEquals(recovered, text)
    const matches = await search({ ...args, query: 'needle', limit: 2 })
    assertEquals(matches.matches.map((m: { offset: number }) => m.offset), [
      7,
      21,
    ])
    await assertRejects(() => read({ ...args, count: 8193 }))
    await assertRejects(() => read({ ...args, start: -1 }))
    await assertRejects(() => read({ ...args, revision: 'wrong' }))
    await assertRejects(() => search({ ...args, query: '' }))
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

test('generic text inspection reads doc and content with reader authorization', async () => {
  const h = await harness()
  try {
    await h.g.apply([{
      entity: { eid: 'note' },
      doc: { body: '😀hello\nworld' },
      content: { body: 'content' },
    }])
    const read = valueRange(async (id) =>
      id == 'note' ? (await h.g.read('.entity.eid=note&*'))[0] : undefined
    )
    const args = {
      entity: 'note',
      component: 'doc',
      property: 'body',
      start: 1,
      count: 5,
    }
    assertEquals((await read(args)).text, 'hello')
    assertEquals(
      (await read({ ...args, component: 'content', start: 0 })).text,
      'conte',
    )
    await assertRejects(() => read({ ...args, entity: 'forbidden' }))
    await assertRejects(() => read({ ...args, property: '__proto__' }))
  } finally {
    h.close()
  }
})

test('model receives bounded tool result, UI keeps original and prompt/user stay intact', async () => {
  const h = await harness()
  const requests: Request[] = []
  const text = 'TOOL '.repeat(30000)
  const user = 'USER '.repeat(4000)
  const a = local({
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
    // Progress can be offered before the bounded final output. A completion
    // may arrive as a result or as a user update to an earlier progress result.
    const sent = requests.flatMap((req) => req.items).find((i) =>
      i.kind == 'result' && i.id == 'call-large' &&
        i.output.includes('graph_value_read') ||
      i.kind == 'user' && i.text.startsWith('Tool call-large completed:') &&
        i.text.includes('graph_value_read')
    )
    assert(sent?.kind == 'result' || sent?.kind == 'user')
    const output = sent.kind == 'result' ? sent.output : sent.text
    assert(output.length < 2000)
    assert(output.includes('graph_value_read'))
    assertEquals(
      requests[0].items.find((i) => i.kind == 'user')?.text.replace(
        /^\[Sent [^\n]*\]\n/,
        '',
      ),
      user,
    )
    const entries = await a.transcript(id)
    assertEquals(
      (entries.find((b) => b.result)?.content as { body: string }).body,
      text,
    )
  } finally {
    await a.close()
  }
})

test('fork projections reuse snapshots and escaped reads stay bounded', async () => {
  const h = await harness()
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
    const parent = await transcript(h.g, 'parent')
    const child = await transcript(h.g, 'child')
    assertEquals(
      await outputView(h.g, child[0]),
      await outputView(h.g, parent[0]),
    )
    const snapshots = await h.g.read('.context_output&*')
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
    // A page is the text itself, unescaped, and never spills again.
    assertEquals(
      reply.split('\n')[0].split(',')[0],
      '[Code points 0 to 8192 of 20000',
    )
    assert(reply.endsWith('\t'.repeat(8192)))
    assert(reply.length < 16384)
  } finally {
    h.close()
  }
})
