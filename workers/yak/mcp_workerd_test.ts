// MCP file writes and reads cross the Worker's schema validator and the
// Durable Object's SQLite authorizer, which native stand-ins cannot replace.
import { test } from '@yaks/testing'
import { assertStringIncludes } from '@std/assert'
import { connector, seed, workerd } from './probe.ts'

test('the hosted connector writes and lists an app file', async () => {
  let k = workerd()
  let space = `mcp${crypto.randomUUID().slice(0, 8)}`
  let { cookie } = await seed(k, [{ slug: space, apps: ['notes'] }])
  let agent = connector(k, cookie)
  let at = { space, app: 'notes' }
  await agent.tool('app_files', {
    ...at,
    files: [{ path: 'index.html', content: '<h1>Notes</h1>' }],
  })
  assertStringIncludes(
    await agent.tool('app_files', { ...at, op: 'list' }),
    'index.html',
  )
})
