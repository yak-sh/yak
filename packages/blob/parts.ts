// Bytes too many for one request go to a bucket in parts: several at once,
// each kept as it lands, so an upload that a dropped connection, a closed tab
// or a sleeping phone cut short picks up where it stopped instead of starting
// over. The parts are the bucket's own multipart upload, the protocol S3
// defined and R2 speaks. What this module adds is what R2's Workers binding
// leaves out, the list of an upload's parts: a **ledger** of empty objects
// whose keys say which upload is under way for some bytes and which of its
// parts have landed, read back in one listing.
//
// An upload is named by the SHA-256 of its bytes, the address they are kept
// under once whole, so sending the same file again, from any device, resumes
// the same upload. When every part is in, the bucket assembles them under that
// address and the result is hashed where it landed: bytes that are not what
// their name says are deleted, so a key never holds another file's bytes.
//
// An upload nobody finishes is the bucket's to forget: R2 aborts one after
// seven days, and a lifecycle rule on the ledger's prefix expires its entries
// (workers/yak/README.md). Its parts are never objects, so no listing of a
// prefix counts them.

import { type Objects, patient } from './object.ts'

/** A bucket's multipart upload, as R2's Workers binding offers it. */
export type Multipart = {
  createMultipartUpload: (key: string) => Promise<{ uploadId: string }>
  resumeMultipartUpload: (key: string, uploadId: string) => Assembly
}

/** One multipart upload under way: its parts, then the whole, or nothing. */
export type Assembly = {
  uploadPart: (
    n: number,
    value: ReadableStream<Uint8Array> | Uint8Array,
  ) => Promise<{ partNumber: number; etag: string }>
  complete: (
    parts: { partNumber: number; etag: string }[],
  ) => Promise<unknown>
  abort: () => Promise<void>
}

/** The most parts one upload has. */
export let MOST = 10_000

/** How many of the whole's first bytes `finish` hands back: enough for a
 * picture's header and a file's signature (`sizeOf`, `contentType`). */
export let HEAD = 256 * 1024

/** An upload that is not under way, never begun or aborted: begin again. */
export class Gone extends Error {}

/** A part, or a whole, that is not what it was said to be. */
export class Wrong extends Error {}

/** Where an upload stands: the size of each part but the last, the parts
 * still to send, and whether the whole is already kept. */
export type Standing = { part: number; need: number[]; stored: boolean }

/** What a finished upload holds: its length and its first bytes. */
export type Whole = { bytes: number; head: Uint8Array<ArrayBuffer> }

/**
 * The part size for `bytes`: `part`, unless that would take more than
 * {@link MOST} parts. Every part but the last is this size, which R2 requires.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { sized } from '@yaks/blob'
 *
 * equal(sized(20_000, 8), 8)
 * equal(sized(200_000, 8), 20)
 * ```
 */
export let sized = (bytes: number, part: number): number =>
  Math.max(part, Math.ceil(bytes / MOST))

// R2's "the specified multipart upload does not exist": aborted, expired, or
// an id it never gave out.
let NO_UPLOAD = 10024

let lost = (e: unknown) => {
  if (Object(e).code != NO_UPLOAD) throw e
}

let hex = (sum: ArrayBuffer) =>
  [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, '0')).join('')

type DigestStream = WritableStream<Uint8Array> & {
  digest: Promise<ArrayBuffer>
}

/**
 * The SHA-256 of a stream, its length, and its first `keep` bytes, in one
 * read. A Worker hashes as the bytes go by (`crypto.DigestStream`); anywhere
 * else the stream is gathered first, which is fine for the tests and the box
 * and is no way to hash a file bigger than memory.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { address, digest, encode } from '@yaks/blob'
 *
 * let read = await digest(new Response('hello').body!, 2)
 * equal(read, { sha: address('hello'), bytes: 5, head: encode('he') })
 * ```
 */
export let digest = async (
  stream: ReadableStream<Uint8Array>,
  keep = 0,
): Promise<{ sha: string; bytes: number; head: Uint8Array<ArrayBuffer> }> => {
  let head = new Uint8Array(keep)
  let bytes = 0
  let tap = new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, out) => {
      if (bytes < keep) head.set(chunk.subarray(0, keep - bytes), bytes)
      bytes += chunk.byteLength
      out.enqueue(chunk)
    },
  })
  let streaming = (crypto as unknown as {
    DigestStream?: new (algorithm: string) => DigestStream
  }).DigestStream
  let sum: ArrayBuffer
  if (streaming) {
    let d = new streaming('SHA-256')
    await stream.pipeThrough(tap).pipeTo(d)
    sum = await d.digest
  } else {
    let all = await new Response(stream.pipeThrough(tap)).arrayBuffer()
    sum = await crypto.subtle.digest('SHA-256', all)
  }
  return { sha: hex(sum), bytes, head: head.slice(0, Math.min(keep, bytes)) }
}

let range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

type Ticket = { id: string; bytes: number; part: number; at: number }

/**
 * The upload of the bytes named `sha` into `key`, in parts of `part` bytes
 * (more, for a file that would need over {@link MOST}), its ledger kept under
 * `ledger`. `objects` is the bucket keyed by name and `bucket` the same
 * bucket's multipart upload.
 *
 * - `stand(bytes)` says where the upload stands, beginning it if nothing is
 *   under way. Once `need` is empty, `finish` makes it whole.
 * - `put(n, body, length)` keeps part `n`, refusing a length that is not the
 *   part's before reading it. A part sent twice is kept once.
 * - `finish()` assembles the parts, checks that they hash to `sha`, and
 *   answers the whole's length and first bytes; for bytes already kept it
 *   only reads them.
 *
 * {@link Gone} says the upload is not under way, so it is begun again;
 * {@link Wrong} says what was sent is not what was said.
 */
export let parts = (
  objects: Objects,
  bucket: Multipart,
  at: { key: string; sha: string; ledger: string; part: number },
) => {
  let { key, sha, ledger } = at
  let begun = `${ledger}${sha}.`
  let ticket = (t: Omit<Ticket, 'at'>) =>
    `${begun}${t.bytes}.${t.part}.${encodeURIComponent(t.id)}`
  let landed = (t: Ticket) => `${ledger}${sha}/${encodeURIComponent(t.id)}/`
  let count = (t: Ticket) => Math.ceil(t.bytes / t.part)

  // The uploads begun for these bytes, newest first: two tabs may begin one
  // each, and whoever comes next carries on the newer.
  let tickets = async (): Promise<Ticket[]> =>
    Object.entries(await objects.uploaded(begun)).map(([k, at]) => {
      let [bytes, part, ...id] = k.slice(begun.length).split('.')
      return {
        id: decodeURIComponent(id.join('.')),
        bytes: +bytes,
        part: +part,
        at,
      }
    }).sort((a, b) => b.at - a.at)

  // Each part's tag as the bucket gave it, the newest where a part was sent
  // again: the bucket keeps the last part sent under a number.
  let receipts = async (t: Ticket) => {
    let prefix = landed(t)
    let got = new Map<number, { etag: string; at: number }>()
    for (let [k, at] of Object.entries(await objects.uploaded(prefix))) {
      let [n, ...etag] = k.slice(prefix.length).split('.')
      let was = got.get(+n)
      if (!was || was.at <= at) {
        got.set(+n, { etag: decodeURIComponent(etag.join('.')), at })
      }
    }
    return got
  }

  let missing = (t: Ticket, have: Map<number, unknown>) =>
    range(count(t)).filter((n) => !have.has(n))

  let drop = async (t: Ticket) =>
    objects.delete([ticket(t), ...await objects.list(landed(t))])

  let head = async (): Promise<Whole> => {
    let held = await objects.open(key)
    if (!held) throw new Gone(`nothing is kept at ${key}`)
    let to = Math.min(HEAD, held.size) - 1
    let first = to < 0 ? new Uint8Array() : new Uint8Array(
      await new Response(await held.read({ from: 0, to })).arrayBuffer(),
    )
    return { bytes: held.size, head: first }
  }

  return {
    stand: async (bytes: number): Promise<Standing> => {
      if (await objects.has(key)) {
        return { part: sized(bytes, at.part), need: [], stored: true }
      }
      let [t] = (await tickets()).filter((t) => t.bytes == bytes)
      if (t) {
        return {
          part: t.part,
          need: missing(t, await receipts(t)),
          stored: false,
        }
      }
      let { uploadId } = await patient(() => bucket.createMultipartUpload(key))
      let fresh = { id: uploadId, bytes, part: sized(bytes, at.part), at: 0 }
      await objects.put(ticket(fresh), new Uint8Array())
      return { part: fresh.part, need: range(count(fresh)), stored: false }
    },

    put: async (
      n: number,
      body: ReadableStream<Uint8Array> | Uint8Array,
      length: number,
    ): Promise<void> => {
      let [t] = await tickets()
      if (!t) throw new Gone(`no upload of ${sha} is under way`)
      let last = count(t)
      if (!(Number.isInteger(n) && n >= 1 && n <= last)) {
        throw new Wrong(`part ${n} is not one of parts 1 to ${last}`)
      }
      let size = n < last ? t.part : t.bytes - t.part * (last - 1)
      if (length != size) {
        throw new Wrong(`part ${n} is ${size} bytes, not ${length}`)
      }
      let sent
      try {
        sent = await bucket.resumeMultipartUpload(key, t.id).uploadPart(n, body)
      } catch (e) {
        lost(e)
        await drop(t)
        throw new Gone(`the upload of ${sha} has expired`)
      }
      let etag = encodeURIComponent(sent.etag)
      await objects.put(`${landed(t)}${n}.${etag}`, new Uint8Array())
    },

    finish: async (): Promise<Whole> => {
      if (await objects.has(key)) return head()
      let [t] = await tickets()
      if (!t) throw new Gone(`no upload of ${sha} is under way`)
      let have = await receipts(t)
      let need = missing(t, have)
      if (need.length) throw new Wrong(`parts ${need.join(', ')} are missing`)
      let up = bucket.resumeMultipartUpload(key, t.id)
      try {
        await up.complete(
          [...have].sort(([a], [b]) => a - b)
            .map(([n, { etag }]) => ({ partNumber: n, etag })),
        )
      } catch (e) {
        // Another request finished it first, or the bucket refused the parts:
        // whole already, or begun again.
        if (await objects.has(key)) return head()
        await up.abort().catch(lost)
        await drop(t)
        throw new Gone(`the parts of ${sha} could not be assembled: ${e}`)
      }
      let whole = await objects.open(key)
      if (!whole) throw new Error(`no object at ${key} once assembled`)
      let read = await digest(await whole.read(), HEAD)
      if (read.sha != sha) {
        await objects.delete(key)
        await drop(t)
        throw new Wrong(`the parts hash to ${read.sha}, not ${sha}`)
      }
      await drop(t)
      return { bytes: read.bytes, head: read.head }
    },
  }
}

/**
 * Multipart for a bucket that has none, its parts held in this process's
 * memory and the whole written through `put`: a host's memory bucket, or a
 * test's.
 */
export let memoryMultipart = (
  put: (key: string, bytes: Uint8Array) => Promise<unknown>,
): Multipart => {
  let open = new Map<
    string,
    {
      key: string
      parts: Map<number, { bytes: Uint8Array<ArrayBuffer>; etag: string }>
    }
  >()
  let n = 0
  let gone = () =>
    Object.assign(new Error('no such upload'), { code: NO_UPLOAD })
  let held = (key: string, id: string) => {
    let up = open.get(id)
    if (!up || up.key != key) throw gone()
    return up
  }
  return {
    createMultipartUpload: (key) => {
      let uploadId = `up.${++n}/${crypto.randomUUID()}`
      open.set(uploadId, { key, parts: new Map() })
      return Promise.resolve({ uploadId })
    },
    resumeMultipartUpload: (key, id) => ({
      uploadPart: async (partNumber, value) => {
        let bytes = value instanceof Uint8Array
          ? new Uint8Array(value)
          : new Uint8Array(await new Response(value).arrayBuffer())
        let etag = `${partNumber}.${++n}`
        held(key, id).parts.set(partNumber, { bytes, etag })
        return { partNumber, etag }
      },
      complete: async (parts) => {
        let up = held(key, id)
        let chunks = parts.map(({ partNumber, etag }) => {
          let part = up.parts.get(partNumber)
          if (part?.etag != etag) {
            throw Object.assign(new Error(`no part ${partNumber}`), {
              code: 10025,
            })
          }
          return part.bytes
        })
        open.delete(id)
        let whole = new Uint8Array(await new Blob(chunks).arrayBuffer())
        await put(key, whole)
        return { size: whole.byteLength }
      },
      abort: () => {
        held(key, id)
        open.delete(id)
        return Promise.resolve()
      },
    }),
  }
}
