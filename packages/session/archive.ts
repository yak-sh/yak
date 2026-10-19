// A compressed log is an asynchronous byte source. Its decoder streams under
// pipe backpressure; no expanded private file is kept, and EOF is successful
// only once the decoder has closed cleanly.

export type Chunks = {
  read: () => Promise<string | undefined>
  close: () => Promise<void>
  done: boolean
}

export let archive = (path: string, signal?: AbortSignal): Chunks => {
  let child = new Deno.Command('zstd', {
    args: ['-dcq', '--', path],
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let reader = child.stdout.getReader()
  let errors = new Response(child.stderr).text()
  let decoder = new TextDecoder()
  let closed = false
  let closing: Promise<void> | undefined
  let source: Chunks = {
    done: false,
    read: async () => {
      if (closed) return undefined
      let chunk = await reader.read()
      if (closed || signal?.aborted) return undefined
      if (!chunk.done) return decoder.decode(chunk.value, { stream: true })
      let status = await child.status
      let error = await errors
      let cancelled = closed || signal?.aborted
      closed = true
      signal?.removeEventListener('abort', abort)
      if (cancelled) return undefined
      if (!status.success) {
        throw new Error(`Cannot read archive ${path}: ${error.trim()}`)
      }
      source.done = true
      return decoder.decode() || undefined
    },
    close: () =>
      closing ??= (async () => {
        signal?.removeEventListener('abort', abort)
        if (closed) return
        closed = true
        await reader.cancel().catch(() => {})
        try {
          child.kill('SIGTERM')
        } catch { /* already closed */ }
        await child.status
        await errors
      })(),
  }
  let abort = () => {
    void source.close()
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  return source
}
