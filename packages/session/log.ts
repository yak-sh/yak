// A transcript's bytes are read and decoded a chunk at a time. Reading an old
// log never decodes the whole file in one turn of the server's event loop.
import * as fs from '@yaks/file/io'
import type { Chunks } from './archive.ts'

type Cursor = {
  path: string
  at: number
  rest: string
  dec: TextDecoder
  stream?: Chunks
  skip?: number
}

/** The byte after `lines` complete lines, without decoding the log. */
export let after = async (path: string, lines: number): Promise<number> => {
  if (!lines) return 0
  let f
  try {
    f = await fs.open(path)
  } catch {
    return 0 // never written: there is nothing to skip
  }
  try {
    let buf = new Uint8Array(64 * 1024), at = 0, seen = 0
    for (let n = await f.read(buf); n; n = await f.read(buf)) {
      let text = buf.subarray(0, n)
      for (let i = text.indexOf(10); i >= 0; i = text.indexOf(10, i + 1)) {
        if (++seen == lines) return at + i + 1
      }
      at += n
    }
    return at
  } finally {
    f.close()
  }
}

// Each read closes before returning: a cursor parked between pulls holds no
// descriptor, even when its caller stops following the transcript.
let sip = async (t: Cursor): Promise<string> => {
  let f
  try {
    f = await fs.open(t.path)
  } catch {
    return '' // never written: the log has said nothing yet
  }
  try {
    await f.seek(t.at, 0)
    let buf = new Uint8Array(64 * 1024)
    let n = await f.read(buf)
    if (!n) return ''
    t.at += n
    return t.dec.decode(buf.subarray(0, n), { stream: true })
  } finally {
    f.close()
  }
}

/** Complete lines in bounded reads. A partial line and split UTF-8 character
 * stay on the cursor; a final read also yields the unterminated last line. */
export let batches = async function* (
  t: Cursor,
  final = false,
): AsyncGenerator<string[]> {
  for (;;) {
    let text = t.rest, end = false
    if (!text.includes('\n')) {
      let more = t.stream ? await t.stream.read() : await sip(t)
      end = t.stream ? more === undefined || t.stream.done : !more
      text += more ?? ''
    }
    let parts = text.split('\n')
    let flush = end && (t.stream ? t.stream.done : final)
    t.rest = flush ? '' : parts.pop() ?? ''
    if (flush && parts.at(-1) === '') parts.pop()
    let skip = Math.min(t.skip ?? 0, parts.length)
    if (t.skip) t.skip -= skip
    if (parts.length > skip) yield parts.slice(skip)
    if (end) return
  }
}

/** A log followed from its first line, with no file held between lines. */
export let records = async function* (path: string): AsyncGenerator<string> {
  let t = { path, at: 0, rest: '', dec: new TextDecoder() }
  for await (let lines of batches(t, true)) yield* lines
}
