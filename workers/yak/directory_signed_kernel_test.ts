// Connector initialization and app seed use the directory authority.
import { equal, ok, test } from '@yaks/testing'
import { connector, kernel, seed } from './probe.ts'

test('signed MCP initialization and app seed use current directory authority', async () => {
  let k = await kernel()
  try {
    let space = 'signeddirectory'
    let { cookie, eids } = await seed(k, [{ slug: space, apps: ['page'] }])
    ok(eids[`${space}/page`])
    let agent = connector(k, cookie)
    let initialized = await agent.call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'signed-directory-proof', version: '1' },
    })
    equal(initialized.protocolVersion, '2025-03-26')
    let listed = await agent.call('tools/list')
    ok(listed.tools.length > 0)
  } finally {
    await k.stop()
  }
})
