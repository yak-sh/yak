// A private HTTP connection pool: each owner can retire broken connections
// without changing other callers' pools. undici is loaded by the first request,
// not by importing this module: it is about 100 CommonJS files, and most
// processes that import a module that can fetch never do.
import type { Dispatcher } from 'undici'

let undici: Promise<typeof import('undici')> | undefined
let loaded = () => undici ??= import('undici')

type Client = {
  fetch: typeof fetch
  /** ends the pool once its requests finish */
  close: () => void | Promise<void>
  /** ends the pool and its connections now */
  destroy?: () => void | Promise<void>
}
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

/** A fetch pool with an explicit lifetime, shared by Node and Deno callers.
 * Without a dispatcher, its own pool opens with its first request. */
export let httpClient = (given?: Dispatcher): Client => {
  let dispatcher = given
  let send: typeof fetch = async (input, init) => {
    let { Agent, fetch: request } = await loaded()
    dispatcher ??= new Agent()
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
  return {
    fetch: send,
    close: () => dispatcher?.close(),
    destroy: () => dispatcher?.destroy(),
  }
}

// A body read that ends with `signal`: undici's body under Deno reads on past
// an abort once its headers have arrived, so a stalled body would never end.
let collect = (response: Response, signal?: AbortSignal | null) => {
  if (!signal) return response.arrayBuffer()
  signal.throwIfAborted()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    let stop = () => reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
    response.arrayBuffer().then(resolve, reject).finally(() =>
      signal.removeEventListener('abort', stop)
    )
  })
}

/** Collect each answer before closing its request's private connection pool. */
export let freshFetch =
  (create: () => Client = httpClient): typeof fetch => async (input, init) => {
    let client = create()
    let signal = init?.signal ??
      (input instanceof Request ? input.signal : undefined)
    try {
      let response = await client.fetch(input, init)
      let body = response.body ? await collect(response, signal) : null
      return answer(body, response)
    } finally {
      // A request the signal cut short may still hold its connection, which a
      // graceful close waits on.
      await (signal?.aborted && client.destroy
        ? client.destroy()
        : client.close())
    }
  }
