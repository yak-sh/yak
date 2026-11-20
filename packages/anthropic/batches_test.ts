// A batch is sent whole, its system text cached, and its results read back as
// lines.
import { equal, test } from '@yaks/testing'
import { batches } from './batches.ts'

let api = (answer: (url: string, init?: RequestInit) => Response) => {
  let asked: string[] = []
  let fetch = (url: string | URL | Request, init?: RequestInit) => {
    asked.push(`${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`.trim())
    return Promise.resolve(answer(String(url), init))
  }
  return {
    asked,
    api: batches({ fetch: fetch as typeof globalThis.fetch, key: () => 'k' }),
  }
}

test('a batch is sent as one request of every entry, its system cached', async () => {
  let { asked, api: b } = api(() =>
    Response.json({ id: 'b1', processing_status: 'in_progress' })
  )
  equal(
    await b.submit([{ id: 's1', model: 'm', system: 'S', text: 'T', max: 9 }]),
    'b1',
  )
  equal(asked, [
    'POST https://api.anthropic.com/v1/messages/batches {"requests":[{"custom_id":"s1","params":{"model":"m","max_tokens":9,"system":[{"type":"text","text":"S","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":"T"}]}}]}',
  ])
})

test("a batch's results are its lines, each one answer", async () => {
  let line = (id: string) =>
    JSON.stringify({ custom_id: id, result: { type: 'expired' } })
  let { asked, api: b } = api(() =>
    new Response(`${line('s1')}\n${line('s2')}\n`)
  )
  equal(await b.results('b1'), [
    { id: 's1', error: 'expired' },
    { id: 's2', error: 'expired' },
  ])
  equal(asked, ['GET https://api.anthropic.com/v1/messages/batches/b1/results'])
})
