import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { connect, MCPError } from './mod.ts'
import { serverOf } from './servers.ts'
import { mcpDoc } from './vocab.ts'
import { loadVocab } from '@yaks/vocab'

test('MCP graph vocabulary is portable, with endpoint identity independent of label', () => {
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

test('a server on a machine is addressed by its path there', () => {
  const row = {
    entity: { eid: 'edba2000-0000-4000-8000-000000000002' },
    mcp_server: {
      name: 'tasks',
      url: '/mcp?x=1',
      machine: 'edba2000-0000-4000-8000-000000000003',
    },
  }
  const { server } = serverOf(row)!
  assertEquals(server.url, 'http://machine/mcp?x=1')
  assertEquals(server.machine, row.mcp_server.machine)
  for (const url of ['https://example.test/mcp', '//example.test/mcp', 'mcp']) {
    assertThrows(() =>
      serverOf({ ...row, mcp_server: { ...row.mcp_server, url } })
    )
  }
  assertThrows(
    () => connect(server),
    MCPError,
    'through its tunnel',
  )
})
