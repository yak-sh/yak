// The form reader (form.ts), fed the way a request body feeds it: a few bytes
// at a time, so each boundary lands across a chunk's edge somewhere.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { gathered } from './bytes.ts'
import { parts } from './form.ts'

let sent = async (form: FormData, size: number, cut = 0) => {
  let whole = new Response(form)
  let bytes = new Uint8Array(await whole.arrayBuffer())
  bytes = bytes.subarray(0, bytes.length - cut)
  let at = 0
  return new Request('https://jeff.yaks.app/deploy', {
    method: 'POST',
    headers: { 'content-type': whole.headers.get('content-type') ?? '' },
    body: new ReadableStream({
      pull: (c) => {
        if (at >= bytes.length) return c.close()
        c.enqueue(bytes.slice(at, at += size))
      },
    }),
  })
}

let form = () => {
  let it = new FormData()
  // A body that holds a line break and two dashes, as a boundary starts.
  it.set(
    'file',
    new File(['<h1>hi</h1>\r\n--not the end'], 'index.html', {
      type: 'text/html',
    }),
  )
  it.set('slug', 'greeting')
  return it
}

let text = async (body: AsyncIterable<Uint8Array<ArrayBuffer>>) =>
  new TextDecoder().decode(await gathered(body, Infinity, () => new Error()))

test('a form comes apart into its parts, whatever its chunks', async () => {
  for (let size of [5, 4096]) {
    let got = []
    for await (let part of parts(await sent(form(), size))) {
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
  for await (let part of parts(await sent(form(), 3))) {
    if (part.name == 'slug') got.push(await text(part.body))
  }
  assertEquals(got, ['greeting'])
})

test('a form cut short is refused', async () => {
  await assertRejects(
    async () => {
      for await (let part of parts(await sent(form(), 7, 10))) {
        await text(part.body)
      }
    },
    Error,
    'stopped before it finished',
  )
})
