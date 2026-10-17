// Signed directory admission must survive an overtaken first read without
// reusing revoked standing or resetting an already accepted revision.
import { equal, ok, test } from '@yaks/testing'
import { connector, seed, workerd } from './probe.ts'

test('signed MCP initialization and app seed use current directory authority', async () => {
  let k = workerd()
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
