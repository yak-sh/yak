// Access to a machine's HTTP listener. Only its transport can identify a local
// caller; an HTTP Host, forwarded header or session id cannot authorize one.
import type { Incoming } from './deno.ts'
import type { Handler } from './route.ts'

let loopback = (host: string) => {
  if (host == '::1' || host == '0:0:0:0:0:0:0:1') return true
  let ip = host.replace(/^::ffff:/i, '').split('.')
  return ip.length == 4 && ip[0] == '127' &&
    ip.every((n) => /^\d{1,3}$/.test(n) && Number(n) <= 255)
}

// Inspect every byte of the expected credential, including on a mismatch.
let matches = (expected: string, supplied: string) => {
  let enc = new TextEncoder()
  let a = enc.encode(expected), b = enc.encode(supplied)
  let diff = a.length ^ b.length
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0)
  return diff == 0
}

/** Admit loopback peers, or a bearer token read afresh for each remote request.
 * Missing transport information fails closed, including when HTTP headers
 * claim the request is local. This wraps every route before dispatch. */
export let secured =
  (handler: Handler, token: () => unknown): Incoming => (request, peer) => {
    if (peer?.remoteAddr && loopback(peer.remoteAddr.hostname)) {
      return handler(request)
    }
    let expected = token()
    let supplied = /^Bearer ([^\s]+)$/i.exec(
      request.headers.get('authorization') ?? '',
    )?.[1]
    if (
      typeof expected == 'string' && expected.length && supplied &&
      matches(expected, supplied)
    ) return handler(request)
    return new Response('a bearer credential is required for remote access', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer' },
    })
  }
