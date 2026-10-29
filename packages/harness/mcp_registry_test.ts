import { test } from '@yaks/testing'
import { assertRejects } from '@std/assert'

import { graphMCP } from './mcp_registry.ts'
import { signins } from '@yaks/connections'

import { harness } from './testing.ts'

test('graph MCP namespace collisions fail explicitly without opening duplicate connections', async () => {
  const h = await harness(), registry = graphMCP(h, signins(h))
  try {
    await h.g.apply(['yaks.app', 'yaks_app'].map((name) => ({
      entity: { eid: crypto.randomUUID() },
      mcp_server: { name, url: 'https://example.test/mcp' },
    })))
    await assertRejects(
      () => registry.tools(),
      Error,
      'Duplicate MCP namespace: yaks_app',
    )
  } finally {
    await registry.close()
    h.close()
  }
})
