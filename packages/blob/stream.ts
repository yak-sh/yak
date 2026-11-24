// Bytes as they flow. A file goes from the request that sent it to the bucket
// that keeps it, or from the bucket to the response that serves it, as a
// stream: a chunk held at a time, so a file is never bounded by the memory of
// the process it passes through. What has to be learned from the bytes on the
// way, their address, their length and their first bytes (a picture's header,
// a file's signature), is read off them as they pass (`hashing`).
//
// A content-addressed store names bytes by their hash, which is known only
// once the last byte has passed. So a stream is kept in two steps (`stage`):
// it lands under a staging key, hashed as it goes, and once the caller has
// decided to keep it, it is moved to its address. A store that holds its bytes
// in this process anyway (memory, a SQLite table) takes them whole.

import { addressOf, keep } from './artifact.ts'
import { hasher } from './sha256.ts'
import type { Blobs } from './store.ts'

/** Bytes sent as a stream, with how many they are where that is known: a
 * form's part or a zip's entry often does not say. */
export type Streamed = { stream: ReadableStream<Uint8Array>; size?: number }

/** Bytes to put: held whole, or a {@link Streamed} stream. */
export type Put = Uint8Array | Streamed

/** How many of a file's first bytes are kept as it passes: enough for a
 * picture's header and a file's signature (`sizeOf`, `contentType`). */
export let HEAD = 256 * 1024

/** The most bytes held whole on their way: a stream of unknown length goes
 * up to a bucket in pieces of this many (at least the 5 MiB R2 takes of every
 * part but the last), and bytes no more than this are put in one trip
 * (`stage`). */
export let PIECE = 8 * 1024 * 1024

/** How many bytes `put` is, where that is known before it is read. */
export let lengthOf = (put: Put): number | undefined =>
  put instanceof Uint8Array ? put.byteLength : put.size

/** Bytes as a {@link Streamed} stream. */
export let streamOf = (bytes: Uint8Array): Streamed => ({
  stream: new Blob([bytes as Uint8Array<ArrayBuffer>]).stream(),
  size: bytes.byteLength,
})

/** Pull one chunk at a time from a parser or another async byte source. */
export let fromChunks = (
  chunks: AsyncIterable<Uint8Array>,
): ReadableStream<Uint8Array> => {
  let next = chunks[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    pull: async (out) => {
      let part = await next.next()
      if (part.done) out.close()
      else out.enqueue(part.value)
    },
    cancel: async () => void await next.return?.(),
  })
}

/** Bytes held whole: for a store that keeps them in this process anyway. */
export let gathered = async (put: Put): Promise<Uint8Array<ArrayBuffer>> =>
  put instanceof Uint8Array
    ? new Uint8Array(put)
    : new Uint8Array(await new Response(put.stream).arrayBuffer())

/** A stream that ran past the most bytes it may be. */
export class TooMany extends Error {
  override name = 'TooMany'
  most: number
  constructor(most: number) {
    super(`more than ${most} bytes`)
    this.most = most
  }
}

/** What passing bytes said: their address, length and first {@link HEAD}. */
export type Seen = { sha: string; size: number; head: Uint8Array<ArrayBuffer> }

/**
 * A pass-through that hashes bytes as they go by, counts them and keeps their
 * first {@link HEAD}. `seen` answers once the last byte has passed. A stream
 * running past `size` or `most` ({@link TooMany}), or ending short of `size`,
 * fails.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { address, hashing } from '@yaks/blob'
 *
 * let { through, seen } = hashing(5)
 * let out = await new Response(new Blob(['hello']).stream().pipeThrough(through)).text()
 * equal([out, (await seen).sha], ['hello', address('hello')])
 * ```
 */
export let hashing = (
  size?: number,
  most = Infinity,
): {
  through: TransformStream<Uint8Array, Uint8Array>
  seen: Promise<Seen>
} => {
  let hash = hasher()
  let head = new Uint8Array(Math.min(HEAD, size ?? HEAD, most))
  let at = 0
  let resolve!: (seen: Seen) => void, reject!: (error: Error) => void
  let seen = new Promise<Seen>((yes, no) => ((resolve = yes), (reject = no)))
  seen.catch(() => {})
  let failed = (error: Error) => (reject(error), error)
  let through = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, controller) => {
      let next = at + chunk.byteLength
      if (next > most) throw failed(new TooMany(most))
      if (size != null && next > size) {
        throw failed(new Error(`more bytes arrived than the ${size} said`))
      }
      hash.add(chunk)
      if (at < head.length) head.set(chunk.subarray(0, head.length - at), at)
      at = next
      controller.enqueue(chunk)
    },
    flush: () => {
      if (size != null && at != size) {
        throw failed(new Error(`${at} bytes arrived, not the ${size} said`))
      }
      resolve({ sha: hash.end(at), size: at, head: head.slice(0, at) })
    },
  })
  return { through, seen }
}

/** Bytes landed but not yet kept. `keep` puts them at their address; `drop`
 * lets the staged copy go, kept or not, and is always called. */
export type Staged = Seen & {
  read: () => Promise<ReadableStream<Uint8Array>>
  keep: () => Promise<void>
  drop: () => Promise<void>
}

/**
 * Bytes staged in `store`, for the caller to keep at their address or drop,
 * refused past `most` ({@link TooMany}). Bytes no more than {@link PIECE} are
 * held and put in one trip. A larger stream goes to a store that stages
 * streams (a bucket) without being held; any other store holds bytes in this
 * process, and is given them whole.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { address, encode, memoryBlobs, stage, streamOf } from '@yaks/blob'
 *
 * let store = memoryBlobs()
 * let staged = await stage(store, streamOf(encode('hello')))
 * await staged.keep()
 * await staged.drop()
 * equal(store.has(address('hello')), true)
 * ```
 */
export let stage = async (
  store: Blobs,
  put: Put,
  most = Infinity,
): Promise<Staged> => {
  let held = await holding(put, Math.min(PIECE, most))
  if (!(held instanceof Uint8Array) && store.stage) {
    return store.stage(held, most)
  }
  let bytes = held instanceof Uint8Array ? held : await gathered({
    stream: held.stream.pipeThrough(hashing(held.size, most).through),
  })
  if (bytes.byteLength > most) throw new TooMany(most)
  let sha = await addressOf(bytes)
  return {
    sha,
    size: bytes.byteLength,
    head: new Uint8Array(bytes.subarray(0, HEAD)),
    read: () => Promise.resolve(streamOf(bytes).stream),
    keep: () => keep(store, sha, bytes),
    drop: () => Promise.resolve(),
  }
}

/**
 * Bytes held whole where they are at most `most`, read off the stream to find
 * out; otherwise a stream that has lost nothing, the bytes read so far ahead
 * of the rest. A caller that does better with small files whole (several put
 * at once) and must not hold a large one asks this first.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { encode, gathered, holding, streamOf } from '@yaks/blob'
 *
 * let small = await holding(streamOf(encode('small')), 8)
 * let large = await holding(streamOf(encode('larger than eight')), 8)
 * equal(small instanceof Uint8Array, true)
 * equal(large instanceof Uint8Array, false)
 * equal(await gathered(large), encode('larger than eight'))
 * ```
 */
export let holding = async (
  put: Put,
  most: number,
): Promise<Uint8Array<ArrayBuffer> | Streamed> => {
  if (put instanceof Uint8Array) return new Uint8Array(put)
  if (put.size != null && put.size > most) return put
  let reader = put.stream.getReader()
  let read: Uint8Array[] = [], held = 0
  while (held <= most) {
    let got = await reader.read()
    if (got.done) {
      let bytes = new Uint8Array(held), at = 0
      for (let chunk of read) bytes.set(chunk, at), at += chunk.byteLength
      return bytes
    }
    read.push(got.value)
    held += got.value.byteLength
  }
  return {
    size: put.size,
    stream: new ReadableStream<Uint8Array>({
      pull: async (c) => {
        let ahead = read.shift()
        if (ahead) return c.enqueue(ahead)
        let got = await reader.read()
        if (got.done) c.close()
        else c.enqueue(got.value)
      },
      cancel: (why) => reader.cancel(why),
    }),
  }
}

/** Bytes kept at their address in `store`, streamed where they are a stream:
 * {@link stage}, keep and drop, for a caller with nothing to decide between. */
export let stored = async (
  store: Blobs,
  put: Put,
  most = Infinity,
): Promise<Seen> => {
  let { keep, drop, sha, size, head } = await stage(store, put, most)
  try {
    await keep()
  } finally {
    await drop()
  }
  return { sha, size, head }
}

/** A request's or a response's body as it arrives, with the length it
 * declares, if any. */
export let bodyOf = (message: Request | Response): Streamed => {
  let declared = Number(message.headers.get('content-length') ?? NaN)
  return {
    stream: message.body ?? new Response('').body!,
    ...Number.isSafeInteger(declared) && declared >= 0
      ? { size: declared }
      : {},
  }
}
