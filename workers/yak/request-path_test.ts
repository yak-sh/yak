import { equal, test } from '@yaks/testing'
import { decodedPath } from './request-path.ts'
import { fetch, PREFIX } from './files.ts'
import { platform } from './serving-probe.ts'
import { visitor } from './page-cache.ts'

let { env } = platform()
for (let path of ['/%', '/%GG', '/%c0', '/%E0%A4%A', '/%ED%A0%80']) {
  test(`an undecodable file path is absent: ${path}`, async () => {
    let response = await fetch(
      new Request(`https://files.invalid/app${path}`, {
        headers: { [PREFIX]: 'ada/cookbook' },
      }),
      env,
    )
    equal(response.status, 404)
    await response.body?.cancel()
  })
  test(`an undecodable Site host is absent: ${path}`, () => {
    equal(visitor(`https://site.invalid/@${path.slice(1)}/cookbook/`), null)
  })
}
test('valid request paths decode once, preserving literal percent and Unicode', () => {
  equal(decodedPath('/caf%C3%A9%20%25.txt'), '/café %.txt')
  equal(decodedPath('/%2525'), '/%25')
})
