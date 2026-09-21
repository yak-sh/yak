// A packfile, version 2, written as a stream: `PACK`, how many objects follow,
// then each one's header and deflated body, then the SHA-1 of all of it.
//
// The format is small enough to give here in full:
//
//   'PACK' 0x00000002 <count>          12 bytes, big-endian
//   per object: <type+size varint> <zlib(body)>
//   <sha1 of every byte above>         20 bytes
//
// Three details are most of it, and each is somewhere a hand-written packer
// usually goes wrong:
//
// - **The count is in the header**, so it is a parameter here rather than
//   something counted on the way past: a packfile cannot be written without
//   knowing first how many objects it holds. Whatever enumerated the objects
//   (./objects.ts) already knows.
// - **The size in an entry's header is the UNPACKED size**, and after the
//   first byte it is little-endian in seven-bit groups; the first byte carries
//   the type in bits 4-6 and only the low four bits of the size.
// - **The body is zlib, not raw deflate.** `CompressionStream('deflate')` is
//   the zlib wrapper Git expects; `'deflate-raw'` (what a zip file uses)
//   writes a packfile no Git will read.
//
// No deltas. Every object is stored whole (`OBJ_*`, never `OBJ_*_DELTA`),
// which the format always permits — a first clone is the full reachable set,
// and delta compression is a size optimisation for later (D-34943).
//
// It streams because a clone is as big as a repository: the trailer digest is
// folded in by ./sha1.ts as the bytes go past, and one object's body is the
// most this holds at a time.

import { concat, type Kind } from './oid.ts'
import { sha1 } from './sha1.ts'

/** One object to pack: its type, and the bytes its id was taken over. */
export type Obj = { type: Kind; bytes: Uint8Array }

// The type numbers a packfile entry uses. 5 is unused, and 6 and 7 are the
// delta types this package does not write.
let CODE: Record<Kind, number> = { commit: 1, tree: 2, blob: 3, tag: 4 }

let utf8 = new TextEncoder()

/** The twelve bytes a packfile opens with. */
export let head = (count: number): Uint8Array<ArrayBuffer> => {
  let out = new Uint8Array(12)
  out.set(utf8.encode('PACK'))
  let view = new DataView(out.buffer)
  view.setUint32(4, 2)
  view.setUint32(8, count)
  return out
}

/** One object's header: its type, and its unpacked size as Git's varint. */
export let entry = (type: Kind, size: number): Uint8Array => {
  let rest = Math.floor(size / 16)
  let out = [(rest ? 0x80 : 0) | (CODE[type] << 4) | (size % 16)]
  while (rest) {
    let seven = rest % 128
    rest = Math.floor(rest / 128)
    out.push((rest ? 0x80 : 0) | seven)
  }
  return Uint8Array.from(out)
}

/** A body as a packfile stores it: zlib, which is `deflate`, not
 * `deflate-raw`. */
export let deflate = async (
  bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> => {
  let zip = new CompressionStream('deflate')
  let write = zip.writable.getWriter()
  // `concat` for the same reason a digest needs it (./oid.ts): a stream will
  // not accept a view that might be over shared memory. It is also not awaited
  // before the read — a writer's promise settles only once the other end has
  // been read, so awaiting it here would deadlock on backpressure.
  let sent = write.write(concat([bytes])).then(() => write.close())
  let read = zip.readable.getReader()
  let parts: Uint8Array[] = []
  while (true) {
    let got = await read.read()
    if (got.done) break
    parts.push(got.value)
  }
  await sent
  return concat(parts)
}

// Every byte of the packfile, in order, with the trailer digest folded in as
// they pass.
async function* chunks(
  count: number,
  objects: AsyncIterable<Obj> | Iterable<Obj>,
): AsyncGenerator<Uint8Array> {
  let sum = sha1()
  let said = 0
  let out = (bytes: Uint8Array) => (sum.update(bytes), bytes)
  yield out(head(count))
  for await (let o of objects) {
    said++
    yield out(entry(o.type, o.bytes.length))
    yield out(await deflate(o.bytes))
  }
  // The header states how many objects follow, and a reader that trusted a
  // wrong count would stop early or run off the end. Better a broken stream
  // than a corrupt packfile.
  if (said != count) {
    throw new Error(`git: pack said ${count} objects and wrote ${said}`)
  }
  yield sum.digest()
}

/**
 * A version 2 packfile over these objects, in this order.
 *
 * ```ts
 * // let bytes = pack(2, [{ type: 'blob', bytes: hello }, commitObj])
 * // await new Response(bytes).arrayBuffer()
 * ```
 */
export let pack = (
  count: number,
  objects: AsyncIterable<Obj> | Iterable<Obj>,
): ReadableStream<Uint8Array> => {
  let it = chunks(count, objects)
  return new ReadableStream({
    pull: async (c) => {
      let { value, done } = await it.next()
      done ? c.close() : c.enqueue(value)
    },
    cancel: () => void it.return(undefined),
  })
}
