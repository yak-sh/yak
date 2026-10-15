// Bytes from a stream, read the way a parser reads them (unzip.ts, form.ts):
// look at what comes next without taking it, then take what was understood.
// A reader holds only what its parser has looked at and not yet taken (a
// header, a delimiter's width, the chunk in hand), never the stream, so a
// parser over one holds a chunk and a little more whatever the stream's
// length.

/** Bytes on an ordinary buffer: what a request body, an inflate and a put
 * all take. */
export type Bytes = Uint8Array<ArrayBuffer>

export type Reader = {
  /** The bytes held, at least `n` of them unless the stream ends first. */
  peek: (n: number) => Promise<Bytes>
  /** Let go of the first `n` bytes held. */
  skip: (n: number) => void
}

/** Two runs of bytes as one. */
export let joined = (a: Bytes, b: Bytes) => {
  let out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** A reader over `chunks`, which it asks for the next one only when a peek
 * needs more than it holds. */
export let reader = (chunks: AsyncIterable<Bytes>): Reader => {
  let next = chunks[Symbol.asyncIterator]()
  let held: Bytes = new Uint8Array(0)
  let ended = false
  return {
    peek: async (n) => {
      while (held.length < n && !ended) {
        let got = await next.next()
        if (got.done) ended = true
        else held = held.length ? joined(held, got.value) : got.value
      }
      return held
    },
    skip: (n) => void (held = held.subarray(n)),
  }
}

/// find(new Uint8Array([1, 2, 3, 2, 3]), new Uint8Array([2, 3])) -> 1
/// find(new Uint8Array([1, 2]), new Uint8Array([2, 3])) -> -1
/** Where `pattern` first sits whole in `bytes`, or -1. */
export let find = (bytes: Bytes, pattern: Bytes) => {
  for (
    let i = bytes.indexOf(pattern[0]);
    i >= 0 && i + pattern.length <= bytes.length;
    i = bytes.indexOf(pattern[0], i + 1)
  ) {
    let j = 1
    while (j < pattern.length && bytes[i + j] == pattern[j]) j++
    if (j == pattern.length) return i
  }
  return -1
}

/**
 * The bytes ahead up to the first place `end` says the run is over, as they
 * come: `end(bytes, taken)` looks at what is held, `taken` bytes into the
 * run, and answers where the run stops in it, or -1. Every place up to the
 * last `look` bytes held is asked about before it is handed on, so `end` may
 * read that far past the place it answers. What stops the run is left held.
 * Refused with `cut` when the stream ends first.
 */
export async function* until(
  r: Reader,
  look: number,
  end: (bytes: Bytes, taken: number) => number,
  cut: () => Error,
): AsyncGenerator<Bytes> {
  let taken = 0
  for (;;) {
    let held = await r.peek(look)
    let at = end(held, taken)
    let n = at >= 0 ? at : held.length - look + 1
    if (at < 0 && held.length < look) throw cut()
    let out = held.subarray(0, n)
    r.skip(n)
    taken += n
    if (n) yield out
    if (at >= 0) return
  }
}

/** The next `n` bytes, as they come. Refused with `cut` when the stream ends
 * first. */
export async function* exactly(
  r: Reader,
  n: number,
  cut: () => Error,
): AsyncGenerator<Bytes> {
  while (n > 0) {
    let held = await r.peek(1)
    if (!held.length) throw cut()
    let out = held.subarray(0, Math.min(n, held.length))
    r.skip(out.length)
    n -= out.length
    yield out
  }
}

/** Every chunk of a run as one array, refused with `over` past `max` bytes,
 * counted as they come rather than as anything claimed. */
export let gathered = async (
  run: AsyncIterable<Bytes>,
  max: number,
  over: () => Error,
) => {
  let parts: Bytes[] = []
  let n = 0
  for await (let part of run) {
    n += part.length
    if (n > max) throw over()
    parts.push(part)
  }
  let out = new Uint8Array(n)
  let at = 0
  for (let part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
