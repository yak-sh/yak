import { toBase64url } from '@yaks/fp'

/** Shared private authorization storage, expiring browser-flow attempts, and
 * the generic authorization-code client for a provider described as data
 * (./client.ts). Protocols that are not that flow — MCP discovery, OpenRouter's
 * key exchange — stay in their own adapters.
 */
export type AuthorizationStore<R extends object> = {
  read(key: string): Promise<R | undefined>
  update<T>(key: string, fn: (record: R) => Promise<T>): Promise<T>
}
/** One attempt. Identity checks prevent late exchanges saving after cancellation. */
export type Attempt = { state: string; until: number; verifier?: string }
export const attempt = (now: number = Date.now()): Attempt => ({
  state: crypto.randomUUID(),
  until: now + 10 * 60 * 1000,
})
/** A verifier's PKCE S256 challenge: its SHA-256, in base64url. */
export const challenge = async (verifier: string): Promise<string> =>
  toBase64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )
/** PKCE S256; verifier is never sent in the authorization URL. */
export const pkce = async (): Promise<
  { verifier: string; challenge: string }
> => {
  const verifier = toBase64url(crypto.getRandomValues(new Uint8Array(32)))
  return { verifier, challenge: await challenge(verifier) }
}
export {
  type Client,
  client,
  OAuthError,
  type Options,
  type Provider,
  type Tokens,
} from './client.ts'
