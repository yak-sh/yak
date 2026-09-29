// The public Site service binding, through workerd rather than the in-process
// fallback used by the Deno kernel tests.
import { assertEquals } from '@std/assert'
import { workerd } from './probe.ts'

Deno.test('workerd serves home and gallery through Site', async () => {
  let k = workerd()
  for (let path of ['/', '/gallery']) {
    let page = await k.at('yaks.app', path)
    assertEquals(page.status, 200, path)
    assertEquals(
      page.headers.get('cache-control'),
      'public, max-age=30, must-revalidate',
      path,
    )
    await page.body?.cancel()
  }
  let review = await k.at('yaks.app', '/gallery/review?t=none')
  assertEquals(review.headers.get('cache-control'), 'private, no-store')
  await review.body?.cancel()
})
