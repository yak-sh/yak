import { derivedEid } from '@yaks/graph/identity'
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { mcpTools } from './mcp.ts'
import { signins } from '@yaks/connections'
import type { Remote } from './mcp_auth.ts'
import { toolEid } from '@yaks/tools'
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
    let text = await tool.run({}, context)
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
