/** Provider authorization shares the MCP panel's private browser/paste transport. */
import { fileAuthorization } from '@yaks/openrouter/host'
import type { Graph } from '@yaks/graph'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
export const OPENROUTER_AUTH = 'OpenRouter (model provider)'
export const providerAuthorization = (g: Graph) => {
  const path = Deno.env.get('OPENROUTER_AUTH_FILE') ??
    `${Deno.env.get('HOME')}/.yaks/openrouter-auth.json`
  const auth = fileAuthorization(path)
  return {
    cancel: auth.cancel,
    key: async (): Promise<string> => {
      const key = await auth.token()
      if (!key) {
        throw new Error(
          'OpenRouter is not connected. Press Esc then A to authorize OpenRouter.',
        )
      }
      return key
    },
    listed: async (): Promise<boolean> =>
      (await g.read('.provider.name=openrouter')).length > 0,
    control: async (
      action: MCPAuthAction,
      callback?: string,
    ): Promise<MCPAuthReply> => {
      if (action === 'begin') return auth.begin()
      if (action === 'cancel') {
        auth.cancel()
        return { message: 'Authorization cancelled' }
      }
      if (action === 'complete') {
        await auth.complete(callback ?? '')
        return {
          message:
            'OpenRouter connected. Select an OpenRouter model explicitly to use it.',
        }
      }
      return {}
    },
  }
}
