import type { Opened } from './object.ts'

// Replay the shared prefix from storage, followed by the still-unread bytes
// of the response. The comparison only holds one chunk from each stream.
let replay = async (
  original: Opened,
  length: number,
  chunk: Uint8Array | undefined,
  rest: ReadableStreamDefaultReader<Uint8Array>,
) => {
  let prefix = length
    ? (await original.read({ from: 0, to: length - 1 }))
      .getReader()
    : null
  return new ReadableStream<Uint8Array>({
    pull: async (out) => {
      if (prefix) {
        let got = await prefix.read()
        if (!got.done) return out.enqueue(got.value)
        prefix.releaseLock()
        prefix = null
      }
      if (chunk) {
        out.enqueue(chunk)
        chunk = undefined
        return
      }
      let got = await rest.read()
      if (got.done) {
        rest.releaseLock()
        out.close()
      } else out.enqueue(got.value)
    },
    cancel: async (why) => {
      await Promise.all([prefix?.cancel(why), rest.cancel(why)])
    },
  })
}

/** Null when `sent` is the stored object's exact bytes. Otherwise return
 * the original response stream, including the bytes read to compare it. */
export let differing = async (
  sent: ReadableStream<Uint8Array>,
  original: Opened,
): Promise<ReadableStream<Uint8Array> | null> => {
  let source = (await original.read()).getReader()
  let reader = sent.getReader()
  let prefix = 0
  let expected: Uint8Array = new Uint8Array(0)
  let offset = 0
  let more = async () => {
    while (offset == expected.length) {
      let got = await source.read()
      if (got.done) return false
      expected = got.value
      offset = 0
    }
    return true
  }
  let matches = async (chunk: Uint8Array) => {
    for (let at = 0; at < chunk.length;) {
      if (!await more()) return false
      let length = Math.min(chunk.length - at, expected.length - offset)
      for (let i = 0; i < length; i++) {
        if (chunk[at + i] != expected[offset + i]) return false
      }
      at += length
      offset += length
    }
    return true
  }
  try {
    while (true) {
      let got = await reader.read()
      if (got.done && !await more()) {
        reader.releaseLock()
        return null
      }
      if (got.done || !await matches(got.value)) {
        return await replay(original, prefix, got.value, reader)
      }
      prefix += got.value.length
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    await source.cancel()
  }
}
