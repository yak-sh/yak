/** OpenRouter, the model provider, signed in through a connection
 * (@yaks/connections) its provider entity owns. */
import {
  begin,
  connect,
  CONNECTION,
  credential,
  type Ctx,
  need,
} from '@yaks/connections'
import type { Attempt } from '@yaks/oauth'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
import type { Harness } from './store.ts'
export const OPENROUTER_AUTH = 'OpenRouter (model provider)'
const REDIRECT = 'http://localhost:8765/oauth/callback'
export const providerAuthorization = (h: Pick<Harness, 'g' | 'vault'>) => {
  const c: Ctx = { graph: h.g, vault: h.vault, redirect: REDIRECT }
  let pending: Attempt | undefined
  const provider = async () =>
    (await h.g.read('.provider.name=openrouter'))[0]?.entity.eid
  // The provider's connection, made needing a key the first time it is asked.
  const held = async (make = false) => {
    const owner = await provider()
    if (!owner) return undefined
    const [found] = await h.g.read(
      `.${CONNECTION}.owner=${owner}&.${CONNECTION}.integration=openrouter`,
    )
    if (found || !make) return found?.entity.eid
    const made = await h.g.apply(
      await need(h.g.read, { owner, integration: 'openrouter' }),
    )
    return made.find((b) => b[CONNECTION])!.entity.eid
  }
  return {
    cancel: () => pending = undefined,
    key: async (): Promise<string> => {
      const eid = await held()
      const key = eid && await credential(c, eid)
      if (!key) {
        throw new Error(
          'OpenRouter is not connected. Press Esc then A to authorize OpenRouter.',
        )
      }
      return key
    },
    listed: async (): Promise<boolean> => !!await provider(),
    control: async (
      action: MCPAuthAction,
      callback = '',
    ): Promise<MCPAuthReply> => {
      if (action === 'begin') {
        const eid = await held(true)
        if (!eid) throw new Error('OpenRouter is not a provider here')
        const { url, attempt } = await begin(c, eid)
        pending = attempt
        return { url, redirectUrl: REDIRECT }
      }
      if (action === 'cancel') {
        pending = undefined
        return { message: 'Authorization cancelled' }
      }
      if (action === 'complete') {
        const attempt = pending
        pending = undefined
        if (!attempt) throw new Error('Authorization expired; begin again')
        await connect(c, (await held())!, { attempt, callback })
        return {
          message:
            'OpenRouter connected. Select an OpenRouter model explicitly to use it.',
        }
      }
      return {}
    },
  }
}
