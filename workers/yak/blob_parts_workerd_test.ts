// R2 requires the native known-length body, which an in-memory bucket cannot
// check. Exercise that contract through the same upload door a page calls.
import { equal, test } from '@yaks/testing'
import { addressOf, START } from '@yaks/blob'
import { seed, unique, workerd } from './probe.ts'

test('a multipart upload keeps R2 native stream length through hashing and reads back unchanged', async () => {
  let k = workerd()
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
  let read = await k.at(`${space}.yaks.app`, file.url)
  equal(read.status, 200)
  equal(new Uint8Array(await read.arrayBuffer()), body)
})
