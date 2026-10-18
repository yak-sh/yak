// The native host's HTTP boundary: providers share a pool, but never retry a
// broken connection. A failed send gets one fresh-pool attempt; an interrupted
// answer is not replayed after its headers have reached the provider adapter.

type Client = Pick<Deno.HttpClient, 'close'>
type Generation = { client: Client; active: number; retired: boolean }

/** A host-owned fetch pool, with an injectable connection seam. */
export let pooledHttp = (options: {
  fetch?: typeof fetch
  client?: () => Client
} = {}) => {
  let go = options.fetch ?? fetch
  let create = options.client ?? (() => Deno.createHttpClient({}))
  let current: Generation | undefined
  let closed = false
  let pool = () => {
    if (closed) throw new Error('HTTP pool is closed')
    return current ??= { client: create(), active: 0, retired: false }
  }
  let retire = (g: Generation) => {
    if (g.retired) return
    g.retired = true
    if (current === g) current = undefined
    if (!g.active) g.client.close()
  }
  let release = (g: Generation) => {
    if (!--g.active && g.retired) g.client.close()
  }
  let send: typeof fetch = async (input, init) => {
    let signal = init?.signal ??
      (input instanceof Request ? input.signal : null)
    // Stream uploads cannot be sent twice. Provider JSON bodies, buffers, and
    // bodyless Requests are replayable; HTTP refusals are never retried here.
    let replay = !(init?.body instanceof ReadableStream) &&
      (!(input instanceof Request) || !input.body || init?.body != null)
    for (let attempt = 0;; attempt++) {
      signal?.throwIfAborted()
      let g = pool()
      g.active++
      let response: Response
      try {
        response = await go(input, { ...init, client: g.client } as RequestInit)
      } catch (error) {
        let broken = !signal?.aborted && error instanceof TypeError
        if (broken) retire(g)
        release(g)
        if (!broken || !replay || attempt) throw error
        continue
      }
      if (!response.body) {
        release(g)
        return response
      }
      let reader = response.body.getReader()
      let done = false
      let finish = () => {
        if (done) return
        done = true
        release(g)
      }
      let body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            let part = await reader.read()
            if (part.done) {
              controller.close()
              finish()
            } else controller.enqueue(part.value)
          } catch (error) {
            if (!signal?.aborted) retire(g)
            controller.error(error)
            finish()
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason)
          } finally {
            finish()
          }
        },
      }, { highWaterMark: 0 })
      let answer = new Response(body, response)
      // Preserve fetch metadata as well as status/headers when owning the body.
      for (let key of ['url', 'redirected', 'type'] as const) {
        Object.defineProperty(answer, key, { value: response[key] })
      }
      return answer
    }
  }
  return {
    fetch: send,
    close: () => {
      closed = true
      if (current) retire(current)
    },
  }
}
