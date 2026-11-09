import { derivedEid } from '@yaks/graph/identity'
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { agent } from './agent.ts'
import { mcpTools } from './mcp.ts'
import { signins } from '@yaks/connections'
import type { Remote } from './mcp_auth.ts'
import { toolEid } from '@yaks/tools'
import { wordsOf } from '@yaks/session'
import { harness } from './testing.ts'

let connected = (
  h: Awaited<ReturnType<typeof harness>>,
  reply: Remote['reply'],
) =>
  mcpTools(h, signins(h), {
    refresh: () => Promise.resolve(),
    tools: () =>
      Promise.resolve([{
        name: 'publish_mockup',
        description: 'Publish a mockup',
        inputSchema: {
          type: 'object',
          properties: { html: { type: 'string' } },
        },
        reply,
        run: () => Promise.reject(new Error('Use the remote reply interface')),
      }]),
    control: () => Promise.resolve({ servers: [] }),
    close: () => Promise.resolve(),
  })

test('tool isError uses expected tool failure rather than a defect', async () => {
  let h = await harness()
  let tools = connected(h, () =>
    Promise.resolve({
      isError: true,
      content: [{ type: 'text', text: 'mockup/1 failed' }],
    }))
  try {
    let [tool] = await tools.snapshot()
    await assertRejects(async () => await tool.run({}), Error, 'mockup/1')
  } finally {
    await tools.close()
    await h.close()
  }
})

test('a reply is read once: its text, or its structured content where it wrote none', async () => {
  let h = await harness()
  type Reply = Awaited<ReturnType<Remote['reply']>>
  let reply: Reply = { content: [] }
  let tools = connected(h, () => Promise.resolve(reply))
  let read = async (
    content: Reply['content'],
    structuredContent?: Reply['structuredContent'],
  ) => {
    reply = { content, structuredContent }
    let [tool] = await tools.snapshot()
    return wordsOf(await tool.run({}))
  }
  let text = { type: 'text' as const, text: 'https://example.test/mockup/1' }
  try {
    assertEquals(await read([text], { saved: '<h1>' }), text.text)
    assertEquals(await read([], { saved: '<h1>' }), '{"saved":"<h1>"}')
    assertEquals(await read([text]), text.text)
  } finally {
    await tools.close()
    await h.close()
  }
})

test('remote images use external artifacts while large text retains bounded context policy', async () => {
  let h = await harness()
  let image = btoa('image-bytes')
  let tools = connected(h, () =>
    Promise.resolve({
      content: [{ type: 'image', mimeType: 'image/png', data: image }, {
        type: 'text',
        text: 'a'.repeat(100000),
      }],
    }))
  try {
    let [tool] = await tools.snapshot()
    await h.g.apply([{ entity: { eid: 's' }, session: {} }, {
      entity: { eid: 'call' },
      entry: { session: 's' },
      call: { to: toolEid(tool.name) },
    }])
    let context = {
      session: 's',
      call: { entity: { eid: 'call' } },
      entries: [],
    }
    let text = wordsOf(await tool.run({}, context))
    assert(!text.includes(image))
    assert(text.includes('Artifact:'))
    let artifacts = await h.g.read('.artifact&*')
    assertEquals(artifacts.length, 1)
    let address = (artifacts[0].artifact as { address: string }).address
    assertEquals(
      new TextDecoder().decode(await h.artifacts.get(address)),
      'image-bytes',
    )
    let attached = await h.g.read('.attachment&*')
    assertEquals(attached.length, 1)
    assertEquals(attached[0].entity.eid, derivedEid('mcp-attachment:call:0'))
    assertEquals(artifacts[0].entity.eid, address)
    await tool.run({}, context)
    assertEquals((await h.g.read('.attachment&*')).length, 1)
    assert(text.endsWith('a'.repeat(100000)))
  } finally {
    await tools.close()
    await h.close()
  }
})

// A short human sentence must not hide a large structured answer from retention.
test('the model receives a summary of a full third-party reply and can query it with custom tools', async () => {
  let h = await harness()
  let reply = {
    content: [{ type: 'text' as const, text: 'These are the rows.' }],
    structuredContent: { rows: [{ title: 'First', body: 'x'.repeat(20_000) }] },
  }
  let remote = connected(h, () => Promise.resolve(reply))
  let requests = 0
  let summary: { id: string; shape: { rows: number; path: string } } | undefined
  let queried = false
  let a = agent({
    h,
    name: 'fake',
    tools: [],
    remote: remote.snapshot,
    model: (req) => {
      requests++
      for (let item of req.items) {
        let text = item.kind == 'result'
          ? item.output
          : item.kind == 'user'
          ? item.text
          : ''
        if (text.includes('"preview"')) {
          summary = JSON.parse(
            text.slice(text.indexOf('{')).split('\ntook ')[0],
          )
        }
      }
      let narrowed = req.items.find((i) =>
        i.kind == 'result' && i.id == 'query'
      )
      if (narrowed?.kind == 'result' && narrowed.output.includes('"First"')) {
        queried = true
      }
      let item = requests == 1
        ? {
          kind: 'call' as const,
          id: 'large',
          name: 'publish_mockup',
          args: '{}',
        }
        : summary && !queried
        ? {
          kind: 'call' as const,
          id: 'query',
          name: 'result_query',
          args: JSON.stringify({
            id: summary.id,
            query: '.structuredContent.rows[0].title',
          }),
        }
        : { kind: 'assistant' as const, text: 'done' }
      return Promise.resolve({
        id: 'r' + requests,
        model: 'fake',
        items: [item],
      })
    },
  })
  try {
    let [tool] = await remote.snapshot()
    let raw = await tool.run({})
    assertEquals(
      typeof raw == 'string' ? undefined : raw.with.output.value,
      reply,
    )
    let session = await a.start('Read those rows.')
    await a.idle(session)
    assert(summary)
    assertEquals(summary?.shape.rows, 1)
    assertEquals(summary?.shape.path, '.structuredContent.rows')
    assertEquals(queried, true)
    let [stored] = await h.g.get([summary!.id], ['context_output'])
    assertEquals(
      JSON.parse(String((stored.context_output as { body: string }).body)),
      reply,
    )
  } finally {
    await remote.close()
    await a.close()
    await h.close()
  }
})
