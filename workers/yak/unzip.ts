// A zip, read in the Worker as it arrives (T-34230): the bytes somebody
// dropped on their space's page, unpacked into the files an app is made of
// (drop.ts). The request body flows through it, and each file comes out whole
// and is let go before the next is read, so a drop of any size holds one file
// at a time (T-124990).
//
// It reads the local file headers, in order, because they come first and the
// bytes follow them; the central directory at the end comes too late to help
// a stream and is never read. A zip written as a stream (macOS's Archive
// Utility writes every zip this way) sets the data-descriptor flag and writes
// zeros for the sizes, which follow the bytes instead: such an entry ends
// where a descriptor records the packed size read so far. No library: the
// runtime already inflates, and fflate's streaming `Unzip` ends such an entry
// at the first four bytes that look like any signature, which a large zip's
// data holds by chance, and reads no flags.
//
// Everything else here is a refusal, and each one answers a sentence, because
// what reads it is a person who dragged a file onto a page (apps.ts `SAYS` is
// the same rule one floor down). A zip may hold anything, and this door takes
// exactly what an app is: files, under the app's own address, small enough to
// serve.
//
//   another compression method   only stored and deflate are read
//   a password                   there is no password to give it
//   a path that escapes          `../`, an absolute path, a backslash
//   more than there is room for  counted as it inflates, not as it claims
//   damaged or cut short         a deflate that will not inflate, an end
//                                that never comes
//
// And two conveniences, because a zip made on a desktop is never bare: a
// single top-level folder is stripped when every entry shares it (unzipping
// `recipes.zip` gives you `recipes/index.html`, and the app is already
// `recipes`), and macOS's own leavings — `__MACOSX/` and `.DS_Store` — are
// dropped rather than deployed.

import { CallError } from '@yaks/tools/errors'
import {
  type Bytes,
  exactly,
  gathered,
  type Reader,
  reader,
  until,
} from './bytes.ts'
import { refuse } from './tool.ts'

export type Entry = { path: string; bytes: Uint8Array<ArrayBuffer> }

let LOCAL = 0x04034b50
let CENTRAL = 0x02014b50
let END = 0x06054b50
let END64 = 0x06064b50
let DESCRIPTOR = 0x08074b50
// The extra field that carries sizes too large for a header's four bytes.
let ZIP64 = 0x0001
let FULL = 0xffffffff

// A zip is little-endian, everywhere.
let u16 = (b: Uint8Array, at: number) => b[at] | b[at + 1] << 8
let u32 = (b: Uint8Array, at: number) =>
  (b[at] | b[at + 1] << 8 | b[at + 2] << 16 | b[at + 3] << 24) >>> 0
let u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 2 ** 32

let name = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/// escapes('index.html') -> false
/// escapes('css/app.css') -> false
/// escapes('../secrets') -> true
/// escapes('a/../../b') -> true
/// escapes('/etc/passwd') -> true
/// escapes('a\\b') -> true
/// escapes('C:/x') -> true
/** A path that would land somewhere other than under the app's own address.
 * Read as segments, so `..` is caught wherever it sits and a name that merely
 * starts with two dots (`..hidden`) is not. */
export let escapes = (path: string) =>
  !path || path.startsWith('/') || path.includes('\\') ||
  /^[A-Za-z]:/.test(path) || path.split('/').includes('..')

// What macOS packs beside the files somebody meant to send. By segment, at any
// depth: which level the resource fork folder lands at depends on what made
// the zip, and neither name is ever a file anybody wants served.
let junk = (path: string) => {
  let parts = path.split('/')
  return parts.includes('__MACOSX') || parts.at(-1) == '.DS_Store'
}

/**
 * Files with the one folder they all sit in taken off their paths, when there
 * is one: `recipes/` for `recipes/index.html` and `recipes/style.css`, and
 * nothing for files at the root or in two folders. A stream cannot know that
 * until its last file is out, so `unzip` hands each file on under the path
 * the zip gave it, and its caller applies this to what it kept.
 */
export let unfolded = <T extends { path: string }>(files: T[]): T[] => {
  let first = files[0]?.path ?? ''
  let top = first.slice(0, first.indexOf('/') + 1)
  return top && files.every((f) => f.path.startsWith(top))
    ? files.map((f) => ({ ...f, path: f.path.slice(top.length) }))
      .filter((f) => f.path)
    : files
}

let big = () =>
  refuse(
    'limit',
    'That unpacks to more than this space has room for.',
  )

let cut = (path: string) => () =>
  refuse('arguments', `That zip stops in the middle of ${path}.`)

let damaged = (path: string) =>
  refuse(
    'arguments',
    `${path} in that zip is damaged and will not unpack — make the zip ` +
      'again from the folder itself.',
  )

// The data of the extra field `id`, or null.
let field = (extra: Uint8Array, id: number) => {
  for (let at = 0; at + 4 <= extra.length; at += 4 + u16(extra, at + 2)) {
    if (u16(extra, at) == id) {
      return extra.subarray(at + 4, at + 4 + u16(extra, at + 2))
    }
  }
  return null
}

// The sizes a local header gives, any it left full read from its ZIP64 field,
// which holds them in eight bytes each, the unpacked size first.
let sized = (head: Uint8Array, extra: Uint8Array) => {
  let packed = u32(head, 18)
  let size = u32(head, 22)
  let wide = field(extra, ZIP64)
  let at = 0
  if (wide && size == FULL) {
    size = u64(wide, at)
    at += 8
  }
  if (wide && packed == FULL) packed = u64(wide, at)
  return { packed, size, wide: !!wide }
}

/**
 * The packed bytes of an entry written as a stream, up to its descriptor,
 * which is then let go. The descriptor's signature is optional, and four
 * bytes of data can look like one, so a place is the end only where a
 * descriptor there records the packed size read so far: signed, `PK\7\8`,
 * a crc and the sizes; unsigned, the crc and the sizes and then the next
 * header. Each size is eight bytes in a ZIP64 entry, four otherwise.
 */
async function* described(r: Reader, width: number, path: string) {
  let look = 8 + 2 * width
  let signed = false
  let size = (b: Uint8Array, at: number) => width == 8 ? u64(b, at) : u32(b, at)
  let end = (b: Uint8Array, taken: number) => {
    // Every `P` is where one could start: the signed one's own signature, or
    // the next header's, `look - 4` bytes after an unsigned one.
    for (
      let q = b.indexOf(0x50);
      q >= 0 && q + 4 <= b.length;
      q = b.indexOf(0x50, q + 1)
    ) {
      let p = q - look + 4
      let next = u32(b, q) == LOCAL || u32(b, q) == CENTRAL
      if (p >= 0 && next && size(b, p + 4) == taken + p) return p
      if (
        q + look <= b.length && u32(b, q) == DESCRIPTOR &&
        size(b, q + 8) == taken + q
      ) {
        signed = true
        return q
      }
    }
    return -1
  }
  yield* until(r, look, end, cut(path))
  r.skip(signed ? look : look - 4)
}

// An entry's packed bytes through the runtime's inflate. A failure of the
// bytes it was handed is the zip's, said as a sentence; one in handing them
// over (a stream cut off) is passed on as it was.
let inflated = async (
  packed: AsyncIterable<Bytes>,
  room: number,
  path: string,
) => {
  let from = packed[Symbol.asyncIterator]()
  let failed: unknown
  let stopped = false
  let out = new ReadableStream<Bytes>({
    pull: async (c) => {
      let got = await from.next().catch((e) => {
        failed = e
        throw e
      })
      if (stopped) return
      if (got.done) c.close()
      else c.enqueue(got.value)
    },
    // The inflate gave up on what it was handed while the next was coming.
    cancel: () => void (stopped = true),
  }).pipeThrough(new DecompressionStream('deflate-raw'))
  try {
    return await gathered(out, room, big)
  } catch (e) {
    throw failed ?? (e instanceof CallError ? e : damaged(path))
  }
}

/**
 * The files in a zip, in the order it holds them, each as it comes out of
 * `chunks`: the next is not read until the one before is taken. Throws a
 * sentence at the first thing it will not take, so a person reads one clear
 * no rather than a list of them. `max` is the room there is for what it
 * unpacks to, counted as it inflates, so a small zip that claims to be a
 * large one is refused by what it produces; the space's exact accounting
 * follows at the write. Paths are the zip's own; `unfolded` takes off a
 * folder they all share.
 */
export async function* unzip(
  chunks: AsyncIterable<Bytes>,
  max: number,
): AsyncGenerator<Entry> {
  let r = reader(chunks)
  let first = await r.peek(30)
  if (first.length < 30 || u32(first, 0) != LOCAL) {
    throw refuse(
      'arguments',
      "That isn't a zip — drop a .zip of your app's files, or a single " +
        'index.html.',
    )
  }
  let total = 0
  let any = false
  for (;;) {
    let head = await r.peek(30)
    let sig = head.length >= 4 ? u32(head, 0) : null
    if (sig == CENTRAL || sig == END || sig == END64) break
    if (sig != LOCAL || head.length < 30) {
      throw refuse('arguments', 'That zip stops before its end.')
    }
    let flags = u16(head, 6)
    let method = u16(head, 8)
    let len = u16(head, 26)
    let at = 30 + len + u16(head, 28)
    head = await r.peek(at)
    let path = name(head.subarray(30, 30 + len))
    if (head.length < at) throw cut(path)()
    let { packed, size, wide } = sized(head, head.subarray(30 + len, at))
    r.skip(at)
    if (flags & 1) {
      throw refuse(
        'arguments',
        `${path} in that zip is password-protected, and there is nowhere ` +
          'here to give it a password.',
      )
    }
    // Written as a stream: the sizes were not known when the header went
    // out, so they are zero here and true in the descriptor after the bytes.
    let streamed = !!(flags & 8)
    let data = streamed
      ? described(r, wide ? 8 : 4, path)
      : exactly(r, packed, cut(path))
    // A folder entry carries no bytes; the paths inside it say the same thing.
    if (path.endsWith('/') || junk(path)) {
      for await (let _ of data) continue
      continue
    }
    if (escapes(path)) {
      throw refuse(
        'arguments',
        `${path} in that zip points outside the app — a zip of the app's ` +
          'own files, with no ../ and no absolute paths.',
      )
    }
    if (method != 0 && method != 8) {
      throw refuse(
        'arguments',
        `${path} in that zip is compressed a way this door cannot read ` +
          `(method ${method}) — zip it again with the ordinary settings.`,
      )
    }
    let room = max - total
    if (!streamed && size > room) throw big()
    let bytes = method == 0
      ? await gathered(data, room, big)
      : await inflated(data, room, path)
    total += bytes.length
    any = true
    yield { path, bytes }
  }
  if (!any) throw refuse('arguments', 'There are no files in that zip.')
}
