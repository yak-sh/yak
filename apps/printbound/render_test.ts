import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { documents, type Door, preparation } from './render.ts'

let bytes = new Uint8Array([1, 2, 3])
let privileged: string[] = [], customer: string[] = []
let app: Door = {
  fetch: (path) => {
    privileged.push(path)
    return Promise.resolve(new Response(bytes))
  },
}
let source: Door = {
  fetch: (path) => {
    customer.push(path)
    return Promise.resolve(
      path.endsWith('/alice')
        ? new Response(bytes)
        : new Response('Not yours', { status: 403 }),
    )
  },
}
let io = documents(app, source, { person: 'alice' }, 'configured-font')

test('a customer knowing another customer artifact SHA cannot import its bytes', async () => {
  equal(await io.read('alice'), bytes)
  await assertRejects(() => io.read('bob'), Error, '403')
  equal(customer, ['/pay/artifacts/alice', '/pay/artifacts/bob'])
  equal(privileged, [])
  equal(await io.read('configured-font'), bytes)
  equal(privileged, ['/pay/artifacts/configured-font'])
})

test('a caller cannot select a privileged artifact by passing it as a font', async () => {
  privileged.length = 0
  await assertRejects(
    () =>
      preparation(app, source, { person: 'alice' }, 'text', {
        title: 'Book',
        markdown: 'Content',
        font: 'bob',
      }),
    Error,
    'embedded font',
  )
  equal(privileged, [])
})

test('signed cross-app source references pass through the supplied fetch boundary', async () => {
  let urls: string[] = []
  let call: typeof fetch = (input) => {
    urls.push(String(input))
    return Promise.resolve(new Response(bytes))
  }
  let io = documents(app, source, { person: 'alice' }, undefined, call)
  equal(
    await io.read(
      'https://coloring.yaks.app/api/pay/artifacts/sha?ticket=scoped',
    ),
    bytes,
  )
  equal(urls, [
    'https://coloring.yaks.app/api/pay/artifacts/sha?ticket=scoped',
  ])
  await assertRejects(
    () => io.read('http://example.com/file.pdf'),
    Error,
    'HTTPS',
  )
})
