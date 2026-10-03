// The harness retains MCP discovery and its terminal control, not provider sign-in.
import { signins } from '@yaks/connections'
import { graphMCP } from './mcp_registry.ts'
import type { Harness } from './store.ts'

export let authorize = (h: Pick<Harness, 'g' | 'vault'>) => {
  let signin = signins(h)
  let mcp = graphMCP(h, signin)
  return {
    run: mcp.control,
    signin,
    mcp,
    close: async () => {
      signin.cancel()
      await mcp.close()
    },
  }
}
