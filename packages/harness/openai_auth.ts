// OpenAI's credential for this harness: an explicit API key, or the ChatGPT
// grant in the person's default OpenAI connection. Refresh stays in the vault.

import { Refused } from '@yaks/graph'
import {
  CODEX,
  type Credential,
  fromChatGPT,
  fromEnv,
  type TransportCredential,
} from '@yaks/openai'
import type { Harness } from './store.ts'
import { type SignIns, signins } from '@yaks/connections'

export type OpenAIAuth = {
  credential: () => Promise<Credential>
  refresh: (stale: TransportCredential) => Promise<Credential>
}

export let openaiCredential = (
  h: Pick<Harness, 'g' | 'vault' | 'person'>,
  env: (name: string) => string | undefined = Deno.env.get,
  signin: SignIns = signins(h),
): OpenAIAuth => {
  let credential = async (): Promise<Credential> => {
    let key = fromEnv(env)
    if (key) return key
    let token = h.person ? await signin.key(h.person, 'openai') : undefined
    if (!token) {
      throw new Refused(
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
      let token = h.person
        ? await signin.refresh(h.person, 'openai', stale.token)
        : undefined
      if (!token) {
        throw new Refused('OpenAI is not connected. Authorize OpenAI again.')
      }
      return fromChatGPT(token)
    },
  }
}
