// A multipart form read as it arrives (drop.ts, T-124990): each part's name,
// file name and type, then its body as the chunks come, so a file part is
// never held whole. `Request.formData()` answers only once the whole body is
// in memory, which is the one thing a drop of any size cannot afford.
//
// A part's body must be read, or left, before the next part is asked for:
// they are one stream, and whatever of a body is left is passed over on the
// way to the next part.

import { type Bytes, find, reader, until } from './bytes.ts'
import { refuse } from './tool.ts'

export type Part = {
  name: string
  /** what the browser called the file, or null for a plain field */
  filename: string | null
  type: string
  body: AsyncGenerator<Bytes>
}

let encode = (text: string) => new TextEncoder().encode(text)

let END = encode('\r\n\r\n')
let HEAD = 16 * 1024

let cut = () =>
  refuse('arguments', 'That upload stopped before it finished — try again.')

/// said('form-data; name="file"; filename="a.zip"', 'filename') -> 'a.zip'
/// said('form-data; name="file"; filename="a.zip"', 'name') -> 'file'
/// said('form-data; name="slug"', 'filename') -> null
/** A parameter of a header's value, as a browser quotes it. */
export let said = (value: string, key: string) =>
  new RegExp(`(?:^|;)\\s*${key}="([^"]*)"`, 'i').exec(value)?.[1] ?? null

/** The parts of the form `req` carries, as they arrive. */
export async function* parts(req: Request): AsyncGenerator<Part> {
  let [, quoted, bare] = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
    req.headers.get('content-type') ?? '',
  ) ?? []
  let boundary = quoted ?? bare
  let stream = req.body
  if (!boundary || !stream) {
    throw refuse('arguments', 'That was not a form with a file in it.')
  }
  // Every delimiter but the first follows a line break; giving the first one
  // its own lets one search find them all.
  let line = encode(`\r\n--${boundary}`)
  let r = reader((async function* () {
    yield encode('\r\n')
    yield* stream
  })())
  let body = () => until(r, line.length, (b) => find(b, line), cut)
  for (;;) {
    // Whatever is left before the next delimiter: the preamble, or the rest
    // of a body its reader left.
    for await (let _ of body()) continue
    r.skip(line.length)
    let after = await r.peek(2)
    if (after.length < 2) throw cut()
    if (after[0] == 0x2d && after[1] == 0x2d) return
    let head = ''
    for (let n = END.length;; n++) {
      let held = await r.peek(n)
      let at = find(held, END)
      if (at >= 0) {
        head = new TextDecoder().decode(held.subarray(2, at))
        r.skip(at + END.length)
        break
      }
      if (held.length < n) throw cut()
      if (held.length > HEAD) {
        throw refuse('arguments', 'That form is malformed.')
      }
      n = held.length
    }
    let headers = new Map(
      head.split('\r\n').map((l) => {
        let at = l.indexOf(':')
        return [l.slice(0, at).trim().toLowerCase(), l.slice(at + 1).trim()]
      }),
    )
    let disposition = headers.get('content-disposition') ?? ''
    yield {
      name: said(disposition, 'name') ?? '',
      filename: said(disposition, 'filename'),
      type: headers.get('content-type') ?? '',
      body: body(),
    }
  }
}
