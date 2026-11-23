// Browse streams a sequence of length-prefixed JSON headers. A header can
// name a byte count, followed by exactly that many raw file bytes. A visit
// ends with a result header, so even a clean EOF can be detected as a loss.
export let WIRE = 'application/vnd.yaks.browse'
export let HTML_LIMIT = 4_000_000
export let HTML_BYTES = HTML_LIMIT * 3

type Bytes = ReadableStream<Uint8Array>
export type Frame<H> = { head: H; size?: number; body?: Bytes }
let MAX_HEAD = 4 * 1024 * 1024

export let header = (head: object, size = 0): Uint8Array<ArrayBuffer> => {
  let json = new TextEncoder().encode(JSON.stringify({ ...head, size }))
  if (json.length > MAX_HEAD) throw new Error('Browse header is too large')
  let bytes = new Uint8Array(4 + json.length)
  new DataView(bytes.buffer).setUint32(0, json.length)
  bytes.set(json, 4)
  return bytes
}

export let streamed = <T>(
  source: AsyncGenerator<T>,
): ReadableStream<T> =>
  new ReadableStream<T>({
    async pull(c) {
      let { done, value } = await source.next()
      if (done) c.close()
      else c.enqueue(value)
    },
    async cancel() {
      await source.return(undefined)
    },
  }, { highWaterMark: 0 })

export let packet = <H extends object>({ head, size, body }: Frame<H>): Bytes =>
  streamed((async function* () {
    yield header(head, size)
    if (body) yield* body
  })())

export class IncompleteBrowse extends Error {}

export let frames = async function* <H>(
  body: Bytes | null,
): AsyncGenerator<Frame<H>> {
  if (!body) throw new IncompleteBrowse('missing browse body')
  let reader = body.getReader()
  let pending = new Uint8Array(0) as Uint8Array
  let fill = async () => {
    while (!pending.length) {
      let read
      try {
        read = await reader.read()
      } catch (cause) {
        throw new IncompleteBrowse('interrupted browse body', { cause })
      }
      if (read.done) return false
      pending = read.value
    }
    return true
  }
  let take = async (count: number) => {
    if (!await fill()) throw new IncompleteBrowse('short browse frame')
    let part = pending.subarray(0, count)
    pending = pending.subarray(part.length)
    return part
  }
  let read = async (size: number) => {
    let bytes = new Uint8Array(size)
    for (let at = 0; at < size;) {
      let part = await take(size - at)
      bytes.set(part, at)
      at += part.length
    }
    return bytes
  }
  try {
    while (await fill()) {
      let length = new DataView((await read(4)).buffer).getUint32(0)
      if (length > MAX_HEAD) {
        throw new IncompleteBrowse('invalid browse header length')
      }
      let head: H & { size: number }
      try {
        head = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
          await read(length),
        ))
      } catch (cause) {
        throw new IncompleteBrowse('invalid browse header', { cause })
      }
      let size = head?.size
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new IncompleteBrowse('invalid browse file length')
      }
      let left = size
      let file = size
        ? streamed((async function* () {
          while (left) {
            let part = await take(left)
            left -= part.length
            yield part
          }
        })())
        : undefined
      yield { head, size, body: file }
      if (left) throw new IncompleteBrowse('unread browse file')
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Edit control headers in flight. File bytes pass through unchanged. */
export let mapped = <H extends object>(
  body: Bytes | null,
  map: (head: H) => H,
  failed?: (e: unknown) => void,
): Bytes =>
  streamed((async function* () {
    try {
      for await (let { head, size, body: file } of frames<H>(body)) {
        yield header(map(head), size)
        if (file) yield* file
      }
    } catch (e) {
      failed?.(e)
      throw e
    }
  })())

export let readAsk = async <H>(
  body: Bytes | null,
): Promise<Frame<H> & { close: () => Promise<unknown> }> => {
  let source = frames<H>(body)
  let first = await source.next()
  if (first.done) throw new IncompleteBrowse('missing browse request')
  let frame = first.value
  let close = () => source.return(undefined)
  let file = frame.body
  if (!file && !(await source.next()).done) {
    await close()
    throw new IncompleteBrowse('extra browse request frame')
  }
  return {
    ...frame,
    close,
    body: file && streamed((async function* () {
      try {
        yield* file
        if (!(await source.next()).done) {
          throw new IncompleteBrowse('extra browse request frame')
        }
      } finally {
        await close()
      }
    })()),
  }
}
