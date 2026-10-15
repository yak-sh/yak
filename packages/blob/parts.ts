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
// the same upload. Each part is hashed as it passes, on from the hash state
// the sender says the bytes before it left (sha256.ts), and its ledger entry
// keeps both states. The parts are assembled only when those states chain
// from SHA-256's start to the address, so the bytes under a key are always
// the bytes its name says, with nothing read back to check.
//
// An upload nobody finishes is the bucket's to forget: R2 aborts one after
// seven days, and a lifecycle rule on the ledger's prefix expires its entries
// (workers/yak/README.md). Its parts are never objects, so no listing of a
// prefix counts them.

import { type Objects, patient } from './object.ts'
import { hasher, START } from './sha256.ts'

/** A bucket's multipart upload, as R2's Workers binding offers it. */
export type Multipart = {
  createMultipartUpload: (key: string) => Promise<{ uploadId: string }>
  resumeMultipartUpload: (key: string, uploadId: string) => Assembly
}

/** One multipart upload under way: its parts, then the whole, or nothing. */
export type Assembly = {
  uploadPart: (
    n: number,
    value: ReadableStream<Uint8Array>,
  ) => Promise<{ partNumber: number; etag: string }>
  complete: (
    parts: { partNumber: number; etag: string }[],
  ) => Promise<{ size: number }>
  abort: () => Promise<void>
}

/** The most parts one upload has. */
export let MOST = 10_000

/** Every part size is a whole number of these, so a sender records its hash
 * state once per MiB and holds the state at every part's start. */
export let MiB = 1024 * 1024

/** How many of the whole's first bytes `post` hands back: enough for a
 * picture's header and a file's signature (`sizeOf`, `contentType`). */
export let HEAD = 256 * 1024

/** An upload that is not under way, never begun or aborted: begin again. */
export class Gone extends Error {}

/** A part, or a whole, that is not what it was said to be. */
export class Wrong extends Error {}

/** What a finished upload holds: its length and its first bytes, and `made`
 * when this `post` assembled it rather than finding it kept already. */
export type Whole = {
  bytes: number
  head: Uint8Array<ArrayBuffer>
  made?: boolean
}

/** Where an upload stands: the size of every part but the last, the parts
 * still to send, and the whole once none are. */
export type Standing = { part: number; need: number[]; whole?: Whole }

/** One upload in parts, as {@link parts} answers it. */
export type Parts = {
  post: (bytes: number) => Promise<Standing>
  put: (
    n: number,
    body: ReadableStream<Uint8Array>,
    length: number,
    from?: string,
  ) => Promise<void>
}

/**
 * The part size for `bytes`: `part`, unless that would take more than
 * {@link MOST} parts, in whole {@link MiB}. Every part but the last is this
 * size, which R2 requires.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { MiB, sized } from '@yaks/blob'
 *
 * equal(sized(20 * MiB, 8 * MiB), 8 * MiB)
 * equal(sized(100_000 * MiB, 8 * MiB), 10 * MiB)
 * ```
 */
export let sized = (bytes: number, part: number): number =>
  bytes <= part * MOST ? part : Math.ceil(bytes / MOST / MiB) * MiB

// R2's "the specified multipart upload does not exist": aborted, expired, or
// an id it never gave out.
let NO_UPLOAD = 10024

let lost = (e: unknown) => {
  if (Object(e).code != NO_UPLOAD) throw e
}

// A stream R2 will take a part from: one whose length is known, which a
// Worker's own FixedLengthStream says. Anywhere else the stream is read.
let fixed = (stream: ReadableStream<Uint8Array>, length: number) => {
  let Fixed = (globalThis as {
    FixedLengthStream?: new (length: number) => TransformStream<
      Uint8Array,
      Uint8Array
    >
  }).FixedLengthStream
  return Fixed ? stream.pipeThrough(new Fixed(length)) : stream
}

let range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

type Ticket = { id: string; bytes: number; part: number; at: number }
type Receipt = { from: string; to: string; etag: string; at: number }

/**
 * The upload of the bytes named `sha` into `key`, in parts of `part` bytes
 * (more, for a file that would need over {@link MOST}), its ledger kept under
 * `ledger`. `objects` is the bucket keyed by name and `bucket` the same
 * bucket's multipart upload.
 *
 * - `post(bytes)` says where the upload stands, beginning it if nothing is
 *   under way, and once nothing is missing makes it whole: `whole` is set,
 *   and `need` is empty.
 * - `put(n, body, length, from)` keeps part `n`, hashed on from `from`, the
 *   state the bytes before it leave ({@link START} for the first). A length
 *   that is not the part's is refused before anything is read, and a part
 *   sent twice is kept once.
 *
 * {@link Gone} says the upload is not under way, so it is begun again;
 * {@link Wrong} says what was sent is not what was said.
 */
export let parts = (
  objects: Objects,
  bucket: Multipart,
  at: { key: string; sha: string; ledger: string; part: number },
): Parts => {
  let { key, sha, ledger } = at
  let begun = `${ledger}${sha}.`
  let ticket = (t: Omit<Ticket, 'at'>) =>
    `${begun}${t.bytes}.${t.part}.${encodeURIComponent(t.id)}`
  let landed = (t: Ticket) => `${ledger}${sha}/${encodeURIComponent(t.id)}/`
  let count = (t: Ticket) => Math.ceil(t.bytes / t.part)

  // The uploads begun for these bytes, newest first: two tabs may begin one
  // each, and whoever comes next carries on the newer.
  let tickets = (held: Record<string, number>): Ticket[] =>
    Object.entries(held).filter(([k]) => k.startsWith(begun))
      .map(([k, at]) => {
        let [bytes, part, ...id] = k.slice(begun.length).split('.')
        let t = {
          id: decodeURIComponent(id.join('.')),
          bytes: +bytes,
          part: +part,
        }
        return { ...t, at }
      }).sort((a, b) => b.at - a.at)

  // Each part's states and tag, the newest where a part was sent again: the
  // bucket keeps the last part sent under a number.
  let receipts = (held: Record<string, number>, t: Ticket) => {
    let prefix = landed(t)
    let got = new Map<number, Receipt>()
    for (let [k, at] of Object.entries(held)) {
      if (!k.startsWith(prefix)) continue
      let [n, from, to, ...etag] = k.slice(prefix.length).split('.')
      let was = got.get(+n)
      if (!was || was.at <= at) {
        got.set(+n, { from, to, etag: decodeURIComponent(etag.join('.')), at })
      }
    }
    return got
  }

  // Everything the ledger says of these bytes, in one listing.
  let book = () => objects.uploaded(`${ledger}${sha}`)

  let drop = (held: Record<string, number>, t: Ticket) =>
    objects.delete([
      ticket(t),
      ...Object.keys(held).filter((k) => k.startsWith(landed(t))),
    ])

  let whole = async (): Promise<Whole | null> => {
    let held = await objects.open(key)
    if (!held) return null
    let to = Math.min(HEAD, held.size) - 1
    let head = to < 0 ? new Uint8Array() : new Uint8Array(
      await new Response(await held.read({ from: 0, to })).arrayBuffer(),
    )
    return { bytes: held.size, head }
  }

  // The parts made whole, when their states chain from the start to `sha`.
  let assemble = async (
    held: Record<string, number>,
    t: Ticket,
    have: Map<number, Receipt>,
  ) => {
    let chain = range(count(t)).map((n) => have.get(n)!)
    let up = bucket.resumeMultipartUpload(key, t.id)
    if (
      chain.some((r, i) => r.from != (i ? chain[i - 1].to : START)) ||
      chain[chain.length - 1].to != sha
    ) {
      await up.abort().catch(lost)
      await drop(held, t)
      throw new Wrong(`the parts sent do not hash to ${sha}`)
    }
    try {
      await up.complete(
        chain.map((r, i) => ({ partNumber: i + 1, etag: r.etag })),
      )
    } catch (e) {
      // Another request finished it first, or the bucket refused the parts:
      // whole already, or begun again.
      let done = await whole()
      if (done) return done
      await up.abort().catch(lost)
      await drop(held, t)
      throw new Gone(`the parts of ${sha} could not be assembled: ${e}`)
    }
    let done = await whole()
    if (!done) throw new Error(`no object at ${key} once assembled`)
    await drop(held, t)
    return { ...done, made: true }
  }

  return {
    post: async (bytes: number): Promise<Standing> => {
      let part = sized(bytes, at.part)
      let [done, held] = await Promise.all([whole(), book()])
      if (done) return { part, need: [], whole: done }
      let [t] = tickets(held).filter((t) => t.bytes == bytes)
      if (!t) {
        let { uploadId } = await patient(() =>
          bucket.createMultipartUpload(key)
        )
        let fresh = { id: uploadId, bytes, part, at: 0 }
        await objects.put(ticket(fresh), new Uint8Array())
        return { part, need: range(count(fresh)) }
      }
      let have = receipts(held, t)
      let need = range(count(t)).filter((n) => !have.has(n))
      if (need.length) return { part: t.part, need }
      return { part: t.part, need, whole: await assemble(held, t, have) }
    },

    put: async (
      n: number,
      body: ReadableStream<Uint8Array>,
      length: number,
      from = START,
    ): Promise<void> => {
      let held = await objects.uploaded(begun)
      let [t] = tickets(held)
      if (!t) throw new Gone(`no upload of ${sha} is under way`)
      let last = count(t)
      if (!(Number.isInteger(n) && n >= 1 && n <= last)) {
        throw new Wrong(`part ${n} is not one of parts 1 to ${last}`)
      }
      let size = n < last ? t.part : t.bytes - t.part * (last - 1)
      if (length != size) {
        throw new Wrong(`part ${n} is ${size} bytes, not ${length}`)
      }
      if (!/^[0-9a-f]{64}$/.test(from)) {
        throw new Wrong(`part ${n} needs the hash state it starts from`)
      }
      // The part goes to the bucket and through the hash side by side. A
      // stream the bucket reads through JavaScript, hashing as it passes,
      // sends a part at a third of the speed (T-124790).
      let hash = hasher(from)
      let [kept, read] = body.tee()
      let reader = read.getReader()
      let hashed = (async () => {
        for (let got; !(got = await reader.read()).done;) hash.add(got.value)
      })()
      hashed.catch(() => {})
      let sent
      try {
        sent = await bucket.resumeMultipartUpload(key, t.id)
          .uploadPart(n, fixed(kept, length))
        await hashed
      } catch (e) {
        await reader.cancel().catch(() => {})
        lost(e)
        await drop(await book(), t)
        throw new Gone(`the upload of ${sha} has expired`)
      }
      let to = hash.end(n == last ? t.bytes : undefined)
      let etag = encodeURIComponent(sent.etag)
      await objects.put(
        `${landed(t)}${n}.${from}.${to}.${etag}`,
        new Uint8Array(),
      )
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
        let bytes = new Uint8Array(await new Response(value).arrayBuffer())
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
