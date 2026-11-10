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

// A body that ends with `signal`: undici's body under Deno reads on past an
// abort once its headers have arrived, so a stalled stream would never end,
// and neither would whoever reads it (a model step a Stop withdrew, the host
// draining behind it). On abort the read in progress fails with the signal's
// reason and the source is cancelled, which ends its request.
let bounded = (
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal | null,
): ReadableStream<Uint8Array> | null => {
  if (!body || !signal) return body
  let reader = body.getReader()
  let release = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let stop = () => {
        controller.error(signal.reason)
        reader.cancel(signal.reason).catch(() => {})
      }
      if (signal.aborted) return stop()
      signal.addEventListener('abort', stop, { once: true })
      release = () => signal.removeEventListener('abort', stop)
    },
    async pull(controller) {
      try {
        let part = await reader.read()
        // An abort already ended the stream; what the source said after is
        // nobody's.
        if (signal.aborted) return
        if (part.done) {
          release()
          controller.close()
        } else controller.enqueue(part.value)
      } catch (error) {
        release()
        if (!signal.aborted) controller.error(error)
      }
    },
    cancel(reason) {
      release()
      return reader.cancel(reason)
    },
  }, { highWaterMark: 0 })
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
    return answer(
      bounded(
        received.body as ReadableStream<Uint8Array> | null,
        options?.signal,
      ),
      received,
    )
  }
  return {
    fetch: send,
    close: () => dispatcher?.close(),
    destroy: () => dispatcher?.destroy(),
  }
}

/** Collect each answer before closing its request's private connection pool. */
export let freshFetch =
  (create: () => Client = httpClient): typeof fetch => async (input, init) => {
    let client = create()
    let signal = init?.signal ??
      (input instanceof Request ? input.signal : undefined)
    try {
      let response = await client.fetch(input, init)
      let body = response.body ? await response.arrayBuffer() : null
      return answer(body, response)
    } finally {
      // A request the signal cut short may still hold its connection, which a
      // graceful close waits on.
      await (signal?.aborted && client.destroy
        ? client.destroy()
        : client.close())
    }
  }
