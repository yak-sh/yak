// An app's store as a terminal client: resolve the CLI's app selector at the
// account door, then use the same HTTP and subscription wire as a local host.
// The login token stays in headers, including the socket handshake — never
// in an address, a query string, or a socket protocol.
import { doorUrl, tokenFor } from '@yaks/cli'
import type { ClientOpts } from '@yaks/client'

// The terminal runtime accepts headers on the WebSocket constructor. DOM
// typings omit that extension; this seam stays out of browser-facing exports.
let Socket = WebSocket as unknown as {
  new (url: string, options: { headers: Record<string, string> }): WebSocket
}

export type Connection = Pick<ClientOpts, 'headers' | 'fetch' | 'connect'>

/** The store URL and authenticated wire for an app the login account reaches. */
export let remote = async (
  app: string,
  host: string,
  state?: string,
  go: typeof fetch = fetch,
): Promise<{ url: string; wire: Connection }> => {
  let token = tokenFor(host, state)
  if (!token) throw new Error('not signed in — run yak login first')
  let headers = { authorization: `Bearer ${token}` }
  let at = new URL('/api/app', doorUrl(host))
  at.searchParams.set('app', app)
  let response = await go(at, { headers })
  let answer = await response.json()
  if (!response.ok) {
    throw new Error(
      answer.error?.message ?? `app resolution refused (${response.status})`,
    )
  }
  return {
    url: answer.url,
    wire: {
      headers,
      fetch: go,
      // Deno's terminal WebSocket takes headers; browser clients authenticate
      // with their own cookie instead. Reconnects use this same handshake.
      connect: (url) => new Socket(url, { headers }),
    },
  }
}
