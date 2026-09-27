// OpenAI's credential for this harness: an explicit API key, or the ChatGPT
// grant kept in the OpenAI provider's connection. Refresh stays in the vault.

import { identityEid } from '@yaks/graph'
import {
  CODEX,
  type Credential,
  fromChatGPT,
  fromEnv,
  type TransportCredential,
} from '@yaks/openai'
import type { Harness } from './store.ts'
import { type SignIns, signins } from './signin.ts'

let OPENAI = identityEid('provider', ['openai'])

export type OpenAIAuth = {
  credential: () => Promise<Credential>
  refresh: (stale: TransportCredential) => Promise<Credential>
}

export let openaiCredential = (
  h: Pick<Harness, 'g' | 'vault'>,
  env: (name: string) => string | undefined = Deno.env.get,
  signin: SignIns = signins(h),
): OpenAIAuth => {
  let credential = async (): Promise<Credential> => {
    let key = fromEnv(env)
    if (key) return key
    let token = await signin.key(OPENAI, 'openai')
    if (!token) {
      throw new Error(
        'OpenAI is not connected. Authorize OpenAI or set OPENAI_API_KEY.',
      )
    }
    return fromChatGPT(token)
  }
  return {
    credential,
    refresh: async (stale: TransportCredential): Promise<Credential> => {
      let key = fromEnv(env)
      if (key || stale.base != CODEX) return key ?? await credential()
      let token = await signin.refresh(OPENAI, 'openai', stale.token)
      if (!token) {
        throw new Error('OpenAI is not connected. Authorize OpenAI again.')
      }
      return fromChatGPT(token)
    },
  }
}
