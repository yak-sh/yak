// A private HTTP connection pool: each owner can retire broken connections
// without changing other callers' pools.
import { Agent, type Dispatcher, fetch as request } from 'undici'

type Client = { fetch: typeof fetch; close: () => void | Promise<void> }
type Answer = {
  status: number
  statusText: string
  headers: Iterable<[string, string]>
  url: string
  redirected: boolean
  type: string
}
let answer = (body: BodyInit | null, source: Answer): Response => {
  let response = new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers: [...source.headers],
  })
  for (let key of ['url', 'redirected', 'type'] as const) {
    Object.defineProperty(response, key, { value: source[key] })
  }
  return response
}

/** A fetch pool with an explicit lifetime, shared by Node and Deno callers. */
export let httpClient = (
  dispatcher: Dispatcher = new Agent(),
): Client => {
  let send: typeof fetch = async (input, init) => {
    let source = input instanceof Request ? input : undefined
    let options = source
      ? {
        method: source.method,
        headers: source.headers,
        body: source.body,
        signal: source.signal,
        redirect: source.redirect,
        credentials: source.credentials,
        cache: source.cache,
        integrity: source.integrity,
        keepalive: source.keepalive,
        mode: source.mode,
        referrer: source.referrer,
        referrerPolicy: source.referrerPolicy,
        ...init,
      }
      : init
    let received = await request(
      source?.url ?? input as string | URL,
      {
        ...options,
        dispatcher,
        duplex: 'half',
      } as Parameters<typeof request>[1],
    )
    return answer(received.body as ReadableStream<Uint8Array> | null, received)
  }
  return { fetch: send, close: () => dispatcher.close() }
}

/** Collect each answer before closing its request's private connection pool. */
export let freshFetch =
  (create: () => Client = httpClient): typeof fetch => async (input, init) => {
    let client = create()
    try {
      let response = await client.fetch(input, init)
      let body = response.body ? await response.arrayBuffer() : null
      return answer(body, response)
    } finally {
      await client.close()
    }
  }
