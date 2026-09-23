/** Provider authorization shares the MCP panel's private browser/paste transport. */
import { authorization } from '@yaks/openrouter/oauth'
import { records } from '@yaks/secrets'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
import type { Harness } from './store.ts'
export const OPENROUTER_AUTH = 'OpenRouter (model provider)'
export const providerAuthorization = (h: Pick<Harness, 'g' | 'vault'>) => {
  const g = h.g
  const auth = authorization({ store: records(g, h.vault, 'openrouter ') })
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
