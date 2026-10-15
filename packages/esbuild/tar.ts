// A tarball's entries as its inflated bytes arrive, a chunk at a time and
// never the whole: the compile reads a package's files out of the tarball it
// keeps (./npm.ts), and a host fills a package's home from the registry's
// tarball as it streams in (./home.ts).

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// A NUL-terminated field of a tar header.
let field = (head: Uint8Array, at: number, length: number) => {
  let bytes = head.subarray(at, at + length)
  let end = bytes.indexOf(0)
  return decode(end < 0 ? bytes : bytes.subarray(0, end))
}

// An entry's path: a ustar header's prefix joined to its name.
let named = (head: Uint8Array) => {
  let name = field(head, 0, 100)
  let ustar = field(head, 257, 6) == 'ustar' && field(head, 263, 2) == '00'
  let prefix = ustar ? field(head, 345, 155) : ''
  return (prefix ? `${prefix}/${name}` : name).replace(/^(?:\.\/)+/, '')
}

/**
 * A reader of a tar's bytes, handed to it in order by `push`: `each` sees an
 * entry's path, size and whether it is a regular file, and answers true to be
 * handed its bytes; `take` gets them, and ends the reading by answering true.
 * `push` answers whether the reading has ended.
 */
export let untar = (
  each: (path: string, size: number, file: boolean) => boolean,
  take: (path: string, bytes: Uint8Array) => boolean | void,
) => {
  let head = new Uint8Array(512)
  let filled = 0, left = 0, pad = 0, at = 0, stop = false
  let path = '', body: Uint8Array | null = null
  let done = () => {
    if (body) stop = !!take(path, body)
    body = null
  }
  return (chunk: Uint8Array) => {
    let i = 0
    while (i < chunk.length && !stop) {
      let n
      if (left) {
        n = Math.min(left, chunk.length - i)
        body?.set(chunk.subarray(i, i + n), at)
        at += n
        left -= n
        if (!left) done()
      } else if (pad) {
        n = Math.min(pad, chunk.length - i)
        pad -= n
      } else {
        n = Math.min(512 - filled, chunk.length - i)
        head.set(chunk.subarray(i, i + n), filled)
        filled += n
        if (filled == 512) {
          filled = 0
          if (head.every((b) => b == 0)) stop = true
          else {
            path = named(head)
            let size = parseInt(field(head, 124, 12).trim(), 8) || 0
            let wants = each(path, size, head[156] == 48 || head[156] == 0)
            body = wants ? new Uint8Array(size) : null
            left = size
            pad = (512 - size % 512) % 512
            at = 0
            if (!size) done()
          }
        }
      }
      i += n
    }
    return stop
  }
}

/** The directory every file of a tarball sits in (npm's `package/`), which
 * installing strips, or '' when they share none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(rooted(['package/a.js', 'package/lib/b.js']), 'package/')
 * assertEquals(rooted(['a.js', 'lib/b.js']), '')
 * ```
 */
export let rooted = (paths: string[]) => {
  let root: string | undefined
  for (let path of paths) {
    let slash = path.indexOf('/')
    if (
      slash <= 0 ||
      (root ??= path.slice(0, slash + 1)) != path.slice(0, slash + 1)
    ) {
      return ''
    }
  }
  return root ?? ''
}
