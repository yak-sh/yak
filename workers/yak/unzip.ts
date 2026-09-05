// A zip, read in the Worker (T-34230): the bytes somebody dropped on their
// space's page, unpacked into the files an app is made of (drop.ts). No
// library — the runtime already inflates, so what is left is the container,
// and the container is a few headers.
//
// It reads the LOCAL file headers, in order, because that is where the bytes
// are; the central directory at the end is read only for what a local header
// can leave out — a zip written as a stream sets the data-descriptor flag and
// writes zeros for the sizes, and the index at the end is the one place those
// sizes exist.
//
// Everything else here is a refusal, and each one answers a SENTENCE, because
// what reads it is a person who dragged a file onto a page (apps.ts `SAYS` is
// the same rule one floor down). A zip may hold anything, and this door takes
// exactly what an app is: files, under the app's own address, small enough to
// serve.
//
//   another compression method   only stored and deflate are read
//   a password                   there is no password to give it
//   a path that escapes          `../`, an absolute path, a backslash
//   more than the ceiling        counted as it inflates, not as it claims
//
// And two conveniences, because a zip made on a desktop is never bare: a
// single top-level folder is stripped when every entry shares it (unzipping
// `recipes.zip` gives you `recipes/index.html`, and the app is already
// `recipes`), and macOS's own leavings — `__MACOSX/` and `.DS_Store` — are
// dropped rather than deployed.

export type Entry = { path: string; bytes: Uint8Array<ArrayBuffer> }

// The most one drop may unpack to. The same 20 MB apps.ts puts on one upload,
// for the same reason — an app's files are pages, not an archive — and here it
// is counted on the way OUT of the decompressor, so a small zip that claims to
// be a large one is refused by what it actually produces.
export let MAX = 20 * 1024 * 1024

let LOCAL = 0x04034b50
let CENTRAL = 0x02014b50
let END = 0x06054b50
let DESCRIPTOR = 0x08074b50

// A zip is little-endian, everywhere.
let u16 = (v: DataView, at: number) => v.getUint16(at, true)
let u32 = (v: DataView, at: number) => v.getUint32(at, true)

let name = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/// escapes('index.html') -> false
/// escapes('css/app.css') -> false
/// escapes('../secrets') -> true
/// escapes('a/../../b') -> true
/// escapes('/etc/passwd') -> true
/// escapes('a\\b') -> true
/// escapes('C:/x') -> true
/** A path that would land somewhere other than under the app's own address.
 * Read as SEGMENTS, so `..` is caught wherever it sits and a name that merely
 * starts with two dots (`..hidden`) is not. */
export let escapes = (path: string) =>
  !path || path.startsWith('/') || path.includes('\\') ||
  /^[A-Za-z]:/.test(path) || path.split('/').includes('..')

// What macOS packs beside the files somebody meant to send. By SEGMENT, at any
// depth: which level the resource fork folder lands at depends on what made
// the zip, and neither name is ever a file anybody wants served.
let junk = (path: string) => {
  let parts = path.split('/')
  return parts.includes('__MACOSX') || parts.at(-1) == '.DS_Store'
}

// The folder every entry sits in, when there is exactly one — `recipes/` for a
// zip of `recipes/index.html` and `recipes/style.css`, and nothing for a zip
// whose files are at its root or in two folders.
let shared = (paths: string[]) => {
  let first = paths[0] ?? ''
  let top = first.slice(0, first.indexOf('/') + 1)
  return top && paths.every((p) => p.startsWith(top)) ? top : ''
}

// The index at the end of the file, as a map of path to what it says about the
// entry. Only what a local header may omit is kept. A zip with no readable
// index answers an empty map: it is a fallback, not the source of truth, and
// an entry that then needs it is refused by name.
let index = (v: DataView, bytes: Uint8Array) => {
  let said = new Map<string, { method: number; packed: number; size: number }>()
  let end = -1
  // The record is 22 bytes plus a comment of up to 64 KB, so the scan back is
  // bounded by that and not by the file.
  for (
    let i = v.byteLength - 22;
    i >= 0 && i >= v.byteLength - 22 - 65_535;
    i--
  ) {
    if (u32(v, i) == END) {
      end = i
      break
    }
  }
  if (end < 0) return said
  let n = u16(v, end + 10)
  let at = u32(v, end + 16)
  for (let i = 0; i < n && at + 46 <= v.byteLength; i++) {
    if (u32(v, at) != CENTRAL) break
    let len = u16(v, at + 28)
    said.set(name(bytes.subarray(at + 46, at + 46 + len)), {
      method: u16(v, at + 10),
      packed: u32(v, at + 20),
      size: u32(v, at + 24),
    })
    at += 46 + len + u16(v, at + 30) + u16(v, at + 32)
  }
  return said
}

let big = () =>
  new Error(
    `That unpacks to more than ${
      MAX / 1024 / 1024
    } MB — an app is pages and pictures, not an archive.`,
  )

// The runtime's own inflate, with the ceiling counted as the bytes come out.
let inflate = async (packed: Uint8Array<ArrayBuffer>, room: number) => {
  let reader = new Blob([packed]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  let parts: Uint8Array[] = []
  let n = 0
  for (;;) {
    let { done, value } = await reader.read()
    if (done || !value) break
    n += value.byteLength
    if (n > room) {
      await reader.cancel()
      throw big()
    }
    parts.push(value)
  }
  let out = new Uint8Array(n)
  let at = 0
  for (let part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/**
 * The files in a zip, in the order it holds them. Throws a sentence at the
 * first thing it will not take, so a person reads one clear no rather than a
 * list of them.
 */
export let unzip = async (
  buf: ArrayBuffer,
  max = MAX,
): Promise<Entry[]> => {
  let bytes = new Uint8Array(buf)
  let v = new DataView(buf)
  if (v.byteLength < 30 || u32(v, 0) != LOCAL) {
    throw new Error(
      "That isn't a zip — drop a .zip of your app's files, or a single " +
        'index.html.',
    )
  }
  let said = index(v, bytes)
  let out: Entry[] = []
  let total = 0
  let at = 0
  while (at + 30 <= v.byteLength && u32(v, at) == LOCAL) {
    let flags = u16(v, at + 6)
    let method = u16(v, at + 8)
    let packed = u32(v, at + 18)
    let size = u32(v, at + 22)
    let len = u16(v, at + 26)
    let path = name(bytes.subarray(at + 30, at + 30 + len))
    let start = at + 30 + len + u16(v, at + 28)
    // Written as a stream: the sizes were not known when the header went out,
    // so they are zero here and true in the index at the end.
    if (flags & 8) {
      let there = said.get(path)
      if (!there) {
        throw new Error(
          `${path} in that zip has no size recorded anywhere in it — make ` +
            'the zip again from the folder itself.',
        )
      }
      method = there.method
      packed = there.packed
      size = there.size
    }
    if (flags & 1) {
      throw new Error(
        `${path} in that zip is password-protected, and there is nowhere ` +
          'here to give it a password.',
      )
    }
    if (packed == 0xffffffff || size == 0xffffffff) throw big()
    let after = start + packed
    if (flags & 8) {
      after += after + 4 <= v.byteLength && u32(v, after) == DESCRIPTOR
        ? 16
        : 12
    }
    // A folder entry carries no bytes; the paths inside it say the same thing.
    if (path.endsWith('/') || junk(path)) {
      at = after
      continue
    }
    if (escapes(path)) {
      throw new Error(
        `${path} in that zip points outside the app — a zip of the app's ` +
          'own files, with no ../ and no absolute paths.',
      )
    }
    if (method != 0 && method != 8) {
      throw new Error(
        `${path} in that zip is compressed a way this door cannot read ` +
          `(method ${method}) — zip it again with the ordinary settings.`,
      )
    }
    if (start + packed > v.byteLength) {
      throw new Error(`That zip stops in the middle of ${path}.`)
    }
    let room = max - total
    if (size > room) throw big()
    let content = method == 0
      ? bytes.slice(start, start + packed)
      : await inflate(bytes.subarray(start, start + packed), room)
    total += content.byteLength
    if (total > max) throw big()
    out.push({ path, bytes: content })
    at = after
  }
  if (!out.length) throw new Error('There are no files in that zip.')
  let top = shared(out.map((e) => e.path))
  return top
    ? out.map((e) => ({ ...e, path: e.path.slice(top.length) }))
      .filter((e) => e.path)
    : out
}
