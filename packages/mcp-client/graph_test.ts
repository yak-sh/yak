import { assert, assertEquals, assertThrows } from '@std/assert'
import { serverOf } from './graph.ts'
import { mcpDoc } from './vocab.ts'
import { loadVocab } from '@yaks/vocab'

Deno.test('MCP graph vocabulary is portable, with endpoint identity independent of label', () => {
  const vocab = loadVocab([mcpDoc])
  assert(vocab.comp('mcp_server'))
  const row = {
    entity: { eid: 'edba2000-0000-4000-8000-000000000001' },
    mcp_server: {
      name: 'Display',
      url: 'https://example.test/mcp',
      allow: '["publish"]',
      client_id: 'public',
    },
  }
  const server = serverOf(row)!
  assertEquals(server.server.name, row.entity.eid)
  assertEquals(server.server.namespace, 'Display')
  assertEquals(server.label, 'Display')
  assertEquals(server.server.allow, ['publish'])
  assertEquals(server.server.oauth, { clientId: 'public' })
  assertEquals(
    serverOf({ ...row, mcp_server: { ...row.mcp_server, enabled: false } }),
    undefined,
  )
  assertThrows(() =>
    serverOf({ ...row, mcp_server: { ...row.mcp_server, allow: '[1]' } })
  )
  assertThrows(() =>
    serverOf({
      ...row,
      mcp_server: {
        ...row.mcp_server,
        url: 'https://user:secret@example.test',
      },
    })
  )
})
