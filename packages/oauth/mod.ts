/** Shared private authorization storage and expiring browser-flow attempts.
 * Protocol discovery and token exchanges belong to provider adapters.
 */
export type AuthorizationStore<R extends object> = {
  read(key: string): Promise<R | undefined>
  update<T>(key: string, fn: (record: R) => Promise<T>): Promise<T>
}
/** One attempt. Identity checks prevent late exchanges saving after cancellation. */
export type Attempt = { state: string; until: number; verifier?: string }
export const attempt = (now = Date.now()): Attempt => ({
  state: crypto.randomUUID(),
  until: now + 10 * 60 * 1000,
})
/** PKCE S256; verifier is never sent in the authorization URL. */
export const pkce = async (): Promise<
  { verifier: string; challenge: string }
> => {
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll(
      '/',
      '_',
    ).replace(/=+$/, '')
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = encode(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )
  return { verifier, challenge }
}
