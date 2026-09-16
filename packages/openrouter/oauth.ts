/** OpenRouter PKCE authorization issues an API key, not an OAuth token bundle. */
import { attempt, type AuthorizationStore, pkce } from '@yaks/oauth'
export type Record = { api_key?: string }
export type Options = {
  store: AuthorizationStore<Record>
  fetch?: typeof fetch
  now?: () => number
}
export const STORE_KEY = 'https://openrouter.ai'
export const authorization = (options: Options) => {
  let pending: (ReturnType<typeof attempt> & { verifier: string }) | undefined
  let busy = false
  let generation = 0
  const now = options.now ?? Date.now
  return {
    begin: async (): Promise<{ url: string; redirectUrl: string }> => {
      if (busy) throw new Error('Authorization exchange is already active')
      const turn = ++generation
      const a = attempt(now())
      pending = undefined
      const keys = await pkce()
      if (turn !== generation) throw new Error('Authorization cancelled')
      pending = { ...a, verifier: keys.verifier }
      // State is part of the callback URL, not an undocumented provider parameter.
      const redirect = new URL(
        'http://localhost:8765/oauth/openrouter/' + a.state,
      )
      const url = new URL('https://openrouter.ai/auth')
      url.searchParams.set('callback_url', redirect.href)
      url.searchParams.set('code_challenge', keys.challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      return { url: url.href, redirectUrl: redirect.href }
    },
    complete: async (callback: string): Promise<void> => {
      if (busy) throw new Error('Authorization exchange is already active')
      const a = pending
      if (!a || a.until <= now()) {
        throw new Error('Authorization expired; begin again')
      }
      let url: URL
      try {
        url = new URL(callback.trim())
      } catch {
        throw new Error('Paste the complete return URL')
      }
      if (
        url.origin !== 'http://localhost:8765' ||
        url.pathname !== '/oauth/openrouter/' + a.state || url.hash ||
        url.username || url.password
      ) throw new Error('Return URL does not match the pending authorization')
      const code = url.searchParams.get('code')
      if (
        url.searchParams.has('error') || !code ||
        url.searchParams.getAll('code').length !== 1
      ) throw new Error('Authorization did not return a single code')
      busy = true
      try {
        const response = await (options.fetch ?? fetch)(
          'https://openrouter.ai/api/v1/auth/keys',
          {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(30000),
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              code,
              code_verifier: a.verifier,
              code_challenge_method: 'S256',
            }),
          },
        )
        if (!response.ok) throw new Error('OpenRouter key exchange failed')
        const value = await response.json()
        if (typeof value?.key !== 'string' || !value.key) {
          throw new Error('OpenRouter returned no API key')
        }
        await options.store.update(STORE_KEY, (record) => {
          if (pending !== a || a.until <= now()) {
            throw new Error('Authorization cancelled or expired')
          }
          record.api_key = value.key
          return Promise.resolve()
        })
      } catch {
        throw new Error(
          'OpenRouter authorization failed; begin again. The code was not retried.',
        )
      } finally {
        if (pending === a) pending = undefined
        busy = false
      }
    },
    cancel: (): void => {
      generation++
      pending = undefined
    },
    token: async (): Promise<string | undefined> =>
      (await options.store.read(STORE_KEY))?.api_key,
  }
}
