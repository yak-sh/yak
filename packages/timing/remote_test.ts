/** Paging readiness is part of drawing a complete remote capture. */
import { equal, ok, test } from '@yaks/testing'
import { tree } from './remote.ts'
let root = { entity: { eid: 'trace' }, trace: { name: 'POST apply' } }
test('remote tree follows every span cursor and preserves separate metric components', async () => {
  let urls: string[] = []
  let result = await tree(
    'platform',
    'trace',
    new AbortController().signal,
    (async (url) => {
      urls.push(String(url))
      return Response.json({
        trace: root,
        spans: [{
          entity: { eid: String(urls.length) },
          span: { trace: 'trace' },
          rows_read: { n: urls.length },
        }],
        ...urls.length == 1 ? { next: 'cursor' } : {},
      })
    }) as typeof fetch,
  )
  equal(result.trace, root)
  equal(result.spans.map((b) => b.rows_read), [{ n: 1 }, { n: 2 }])
  ok(urls[1].includes('after=cursor'))
})
test('a refused later page never returns a partial remote tree', async () => {
  let calls = 0, caught = ''
  try {
    await tree(
      'platform',
      'trace',
      new AbortController().signal,
      (async () => {
        return ++calls == 1
          ? Response.json({ trace: root, spans: [], next: 'cursor' })
          : Response.json({ error: 'refused' }, { status: 502 })
      }) as typeof fetch,
    )
  } catch (e) {
    caught = (e as Error).message
  }
  equal(caught, 'refused')
  equal(calls, 2)
})
