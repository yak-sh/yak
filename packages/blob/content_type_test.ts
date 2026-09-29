import { assertEquals } from '@std/assert'
import { contentType } from './content_type.ts'

let bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part == 'string' ? [...part].map((c) => c.charCodeAt(0)) : part
    ),
  )

Deno.test('a binary signature overrides a mistaken declared type', async () => {
  let png = bytes(
    [0x89],
    'PNG\r\n\x1a\n',
    [0, 0, 0, 13],
    'IHDR',
    new Array(21).fill(0),
  )
  assertEquals(await contentType(png, 'video/mp4'), 'image/png')
})

Deno.test('artifact types survive when their supported signatures are shorter than file sniffing needs', async () => {
  let png = bytes([0x89], 'PNG\r\n\x1a\n', [0, 0, 0, 0])
  let mp3 = bytes('ID3music')
  assertEquals(await contentType(png, 'image/png'), 'image/png')
  assertEquals(await contentType(mp3, 'audio/mpeg'), 'audio/mpeg')
  assertEquals(await contentType(mp3, 'audio/wav'), 'application/octet-stream')
  assertEquals(
    await contentType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'), 'audio/wav'),
    'audio/wav',
  )
})

Deno.test('text keeps its declared format when its bytes are valid text', async () => {
  let body = new TextEncoder().encode('# A note\n')
  assertEquals(await contentType(body, 'text/markdown'), 'text/markdown')
  assertEquals(await contentType(body, 'text/plain'), 'text/plain')
  assertEquals(await contentType(body, 'video/mp4'), 'application/octet-stream')
})

Deno.test('unknown binary and malformed declarations are generic', async () => {
  assertEquals(
    await contentType(new Uint8Array([0, 1, 2]), 'text/html'),
    'application/octet-stream',
  )
  assertEquals(
    await contentType(new TextEncoder().encode('hello'), 'bad\r\nheader'),
    'application/octet-stream',
  )
})
