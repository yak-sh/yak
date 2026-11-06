import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { fetched } from './tools.ts'

for (
  let [from, saying] of [
    ['cdnjs.example/chess.js', 'is not a URL'],
    ['http://cdnjs.example/chess.js', 'https only, not http'],
    ['file:///etc/passwd', 'https only, not file'],
  ]
) {
  test(`a fetch refuses ${from} before asking the web`, async () => {
    await assertRejects(
      () =>
        fetched(from, () => {
          throw Error('unexpected fetch')
        }),
      Error,
      saying,
    )
  })
}

let library = new Response('export let go = () => {}', {
  headers: { 'content-type': 'text/javascript; charset=utf-8' },
})
let missingLibrary = new Response('nope', { status: 404 })

test('a fetch takes https, a live answer, and nothing over the ceiling', async () => {
  let got = await fetched('https://cdnjs.example/chess.js', (at) => {
    assertEquals(String(at), 'https://cdnjs.example/chess.js')
    return Promise.resolve(library)
  })
  assertEquals(new TextDecoder().decode(got.bytes), 'export let go = () => {}')
  assertEquals(got.mime, 'text/javascript')
})

test('a fetch refuses a web response that failed', async () => {
  await assertRejects(
    () =>
      fetched(
        'https://cdnjs.example/gone.js',
        () => Promise.resolve(missingLibrary),
      ),
    Error,
    'answered 404',
  )
})
