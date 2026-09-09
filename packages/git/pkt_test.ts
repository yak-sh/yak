// The framing, byte for byte: the length counts itself, a marker is shorter
// than a header can be, and everything written comes back as it went in.

import { assertEquals, assertThrows } from '@std/assert'
import { BAND, band, DELIM, END, FLUSH, mark, MAX, pkt, read } from './pkt.ts'

let text = new TextDecoder()
let utf8 = new TextEncoder()
let said = (bytes: Uint8Array) => text.decode(bytes)

Deno.test('a line states its own length, four bytes included', () => {
  assertEquals(said(pkt('done\n')), '0009done\n')
  assertEquals(said(pkt('')), '0004')
  assertEquals(said(pkt('a'.repeat(0x10 - 4))), '0010' + 'a'.repeat(12))
})

Deno.test('the markers are the three lengths no packet can have', () => {
  assertEquals([said(mark(FLUSH)), said(mark(DELIM)), said(mark(END))], [
    '0000',
    '0001',
    '0002',
  ])
})

Deno.test('a packet longer than the format allows is refused', () => {
  assertEquals(pkt(new Uint8Array(MAX)).length, MAX + 4)
  assertThrows(() => pkt(new Uint8Array(MAX + 1)), Error, '65517 bytes')
})

Deno.test('reading gives lines without their newline, markers as numbers', () => {
  let wire = new Uint8Array([
    ...pkt('command=fetch\n'),
    ...mark(DELIM),
    ...pkt('want ' + 'a'.repeat(40) + '\n'),
    ...pkt('done\n'),
    ...mark(FLUSH),
  ])
  assertEquals(read(wire), [
    'command=fetch',
    DELIM,
    'want ' + 'a'.repeat(40),
    'done',
    FLUSH,
  ])
})

Deno.test('a line that is not a line is refused, never guessed', () => {
  assertThrows(() => read(utf8.encode('zzzzhi')), Error, 'length zzzz')
  assertThrows(() => read(utf8.encode('0020hi')), Error, 'past end')
})

Deno.test('a side-band packet spends one byte on the band', () => {
  assertEquals(said(band(1, utf8.encode('PACK'))), '0009\x01PACK')
  assertEquals(BAND, MAX - 1)
  assertEquals(band(1, new Uint8Array(BAND)).length, MAX + 4)
})
