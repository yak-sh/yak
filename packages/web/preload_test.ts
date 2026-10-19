// Metadata hints preserve the page response and match its credentialed reads.
import { equal, test } from '@yaks/testing'
import { preload } from './preload.ts'

let page = new Response('page bytes', {
  headers: { etag: '"page"', 'cache-control': 'no-cache' },
})
let unmodified = new Response(null, {
  status: 304,
  headers: { etag: '"page"' },
})

test('preloaded pages keep their body, status and validators', async () => {
  let answer = preload(page)
  equal(answer, page)
  equal(answer.status, 200)
  equal(answer.headers.get('etag'), '"page"')
  equal(answer.headers.get('cache-control'), 'no-cache')
  equal(await answer.text(), 'page bytes')
})

test('a revalidated page still starts both same-origin metadata reads', () => {
  let answer = preload(unmodified)
  equal(answer.status, 304)
  equal(answer.body, null)
  equal(answer.headers.get('etag'), '"page"')
  equal(answer.headers.get('link')?.split(', '), [
    '</vocab>; rel=preload; as=fetch; crossorigin=anonymous',
    '</web/owner>; rel=preload; as=fetch; crossorigin=anonymous',
  ])
})
