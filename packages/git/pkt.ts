// pkt-line: the framing every byte of git's wire travels in. Four hex digits
// saying how long the packet is, counting the four, then that many bytes.
//
//   0009done\n            a line: 9 bytes in all, 5 of payload
//   0000                  flush — the end of a message
//   0001                  delim — the end of a command's capabilities
//   0002                  response-end — the end of a multiplexed response
//
// THE LENGTH INCLUDES ITSELF, which is the one thing a hand-written encoder
// gets wrong, and the reason `0000`-`0003` can be markers at all: no real
// packet can be shorter than its own header. `0003` is unused, and `0004` is a
// legal empty line rather than a marker.
//
// A marker is read back as its own number, and a line as its text with the
// trailing newline cut — so `typeof p == 'string'` is the whole of telling a
// line from a marker, and no line's text can be mistaken for one.
//
// The longest packet is 65520 bytes, so the longest payload is 65516; git
// calls that LARGE_PACKET_MAX. A side-band packet spends one more byte on the
// band it belongs to, which is why {@link BAND} is one less again.
//
// Nothing here streams. A request off the wire is wants and haves — kilobytes
// — and reading it whole is simpler than a decoder with a resume point. The
// answer is what streams (./http.ts), and it is written, not parsed.

import { concat } from './oid.ts'

let utf8 = new TextEncoder()
let text = new TextDecoder()

/** The end of a message. */
export let FLUSH = 0

/** The end of a command's capabilities, before its arguments. */
export let DELIM = 1

/** The end of one response inside a multiplexed stream. */
export let END = 2

/** A packet as it is read back: a line's text, or the marker's own number. */
export type Pkt = string | number

/** The most one packet can carry. */
export let MAX = 65516

/** The most one side-band packet can carry: a packet, less the band byte. */
export let BAND = MAX - 1

let four = (n: number) => n.toString(16).padStart(4, '0')

/** One of the markers, as the four bytes it is on the wire. */
export let mark = (which: number): Uint8Array<ArrayBuffer> =>
  utf8.encode(four(which))

/** One pkt-line over this payload. Give a line its own trailing newline: git
 * writes one and this does not add it, because a packet is bytes. */
export let pkt = (data: string | Uint8Array): Uint8Array<ArrayBuffer> => {
  let body = typeof data == 'string' ? utf8.encode(data) : data
  if (body.length > MAX) {
    throw new Error(`git: pkt-line of ${body.length} bytes, max ${MAX}`)
  }
  return concat([utf8.encode(four(4 + body.length)), body])
}

/** One side-band packet: which band these bytes belong to (1 pack data, 2
 * progress, 3 error), then the bytes. */
export let band = (which: number, data: Uint8Array): Uint8Array<ArrayBuffer> =>
  pkt(concat([Uint8Array.of(which), data]))

let LEN = /^[0-9a-f]{4}$/

/** Every packet in these bytes, in order: lines as text without their trailing
 * newline, markers as their number. */
export let read = (bytes: Uint8Array): Pkt[] => {
  let out: Pkt[] = []
  let at = 0
  while (at < bytes.length) {
    let head = text.decode(bytes.subarray(at, at + 4))
    if (!LEN.test(head)) throw new Error(`git: pkt-line length ${head}`)
    let len = parseInt(head, 16)
    if (len < 4) {
      out.push(len)
      at += 4
      continue
    }
    if (at + len > bytes.length) throw new Error('git: pkt-line runs past end')
    let line = text.decode(bytes.subarray(at + 4, at + len))
    out.push(line.endsWith('\n') ? line.slice(0, -1) : line)
    at += len
  }
  return out
}
