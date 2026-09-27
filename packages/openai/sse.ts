/** JSON SSE frames across arbitrary byte chunks; protocol errors are supplied by the caller. */
export let jsonFrames = async function* (
  body: ReadableStream<Uint8Array>,
  fault: (kind: 'transport' | 'malformed_stream', message: string) => Error,
): AsyncGenerator<Record<string, unknown>> {
  let reader = body.getReader()
  let frame = (block: string) => {
    let data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || data == '[DONE]') return
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      throw fault('malformed_stream', 'malformed SSE data')
    }
    if (!value || typeof value != 'object' || Array.isArray(value)) {
      throw fault('malformed_stream', 'SSE data is not an object')
    }
    return value as Record<string, unknown>
  }
  try {
    let decoder = new TextDecoder()
    let pending = ''
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>
      try {
        part = await reader.read()
      } catch (error) {
        if ((error as Error)?.name == 'AbortError') throw error
        throw fault('transport', 'error reading a body from connection')
      }
      pending += decoder.decode(part.value, { stream: !part.done })
      let blocks = pending.split(/\r?\n\r?\n/)
      pending = blocks.pop() ?? ''
      for (let block of blocks) {
        let value = frame(block)
        if (value) yield value
      }
      if (part.done) break
    }
    if (pending.trim()) {
      let value = frame(pending)
      if (value) yield value
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
