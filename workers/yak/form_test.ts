// The form reader (form.ts), fed the way a request body feeds it: a few bytes
// at a time, so each boundary lands across a chunk's edge somewhere.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { gathered } from './bytes.ts'
import { parts } from './form.ts'

// A serialized request is fixture input; the subject reads its parts. A fixed
// delimiter also makes every chunk edge reproducible (the short chunks below
// split it, the headers and the body's boundary-like text).
let boundary = 'yak-test-boundary'
let encoded = new TextEncoder().encode([
  `--${boundary}`,
  'Content-Disposition: form-data; name="file"; filename="index.html"',
  'Content-Type: text/html',
  '',
  '<h1>hi</h1>\r\n--not the end',
  `--${boundary}`,
  'Content-Disposition: form-data; name="slug"',
  '',
  'greeting',
  `--${boundary}--`,
  '',
].join('\r\n'))
let sent = (size: number, cut = 0) => {
  let bytes = encoded
  bytes = bytes.subarray(0, bytes.length - cut)
  return new Request('https://jeff.yaks.app/deploy', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: new ReadableStream({
      start: (c) => {
        for (let at = 0; at < bytes.length; at += size) {
          c.enqueue(bytes.subarray(at, at + size))
        }
        c.close()
      },
    }),
  })
}

let text = async (body: AsyncIterable<Uint8Array<ArrayBuffer>>) =>
  new TextDecoder().decode(await gathered(body, Infinity, () => new Error()))

test('a form comes apart into its parts, whatever its chunks', async () => {
  for (let size of [5, 4096]) {
    let got = []
    for await (let part of parts(sent(size))) {
      got.push([part.name, part.filename, part.type, await text(part.body)])
    }
    assertEquals(got, [
      ['file', 'index.html', 'text/html', '<h1>hi</h1>\r\n--not the end'],
      ['slug', null, '', 'greeting'],
    ])
  }
})

test('a part left unread is passed over', async () => {
  let got = []
  for await (let part of parts(sent(3))) {
    if (part.name == 'slug') got.push(await text(part.body))
  }
  assertEquals(got, ['greeting'])
})

test('a form cut short is refused', async () => {
  await assertRejects(
    async () => {
      for await (let part of parts(sent(7, 10))) {
        await text(part.body)
      }
    },
    Error,
    'stopped before it finished',
  )
})
