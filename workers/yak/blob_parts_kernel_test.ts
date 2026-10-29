// Multipart uploads keep their bytes and metadata through the upload door.
import { equal, test } from '@yaks/testing'
import { addressOf, START } from '@yaks/blob'
import { kernel, seed, unique } from './probe.ts'

test('a multipart upload keeps its length through hashing and reads back unchanged', async () => {
  let k = await kernel()
  let space = unique('r2parts')
  let { cookie } = await seed(k, [{ slug: space, apps: ['files'] }])
  let body = new Uint8Array(150).map((_, i) => i)
  let sha = await addressOf(body)
  let path = `/files/api/blob/${sha}`
  let send = (suffix: string, init: RequestInit) =>
    k.at(`${space}.yaks.app`, path + suffix, {
      ...init,
      headers: { cookie, ...init.headers },
    })
  let begin = () =>
    send('', {
      method: 'POST',
      body: JSON.stringify({ bytes: body.length, name: 'bytes.bin' }),
    })
  let started = await begin()
  equal(started.status, 200)
  equal((await started.json()).need, [1])
  let part = await send('/1', {
    method: 'PUT',
    headers: { 'x-yak-state': START, 'content-length': String(body.length) },
    body,
  })
  equal([part.status, await part.json()], [200, { n: 1 }])
  let completed = await begin()
  equal(completed.status, 200)
  let file = await completed.json()
  let head = await k.at(`${space}.yaks.app`, file.url, { method: 'HEAD' })
  equal([head.status, head.headers.get('content-length'), await head.text()], [
    200,
    String(body.length),
    '',
  ])
  let read = await k.at(`${space}.yaks.app`, file.url)
  equal([read.status, read.headers.get('content-length')], [
    200,
    String(body.length),
  ])
  equal(new Uint8Array(await read.arrayBuffer()), body)
  let unchanged = await k.at(`${space}.yaks.app`, file.url, {
    method: 'HEAD',
    headers: { 'if-none-match': read.headers.get('etag')! },
  })
  equal([unchanged.status, await unchanged.text()], [304, ''])
  let seek = await k.at(`${space}.yaks.app`, file.url, {
    headers: { range: 'bytes=17-40' },
  })
  equal([
    seek.status,
    seek.headers.get('content-length'),
    seek.headers.get('content-range'),
    new Uint8Array(await seek.arrayBuffer()),
  ], [206, '24', `bytes 17-40/${body.length}`, body.slice(17, 41)])
})
