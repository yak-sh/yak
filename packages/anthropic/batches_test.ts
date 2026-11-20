// A batch is sent whole and its results are read back as lines.
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

test('a batch is sent as one request of every entry', async () => {
  let { asked, api: b } = api(() =>
    Response.json({ id: 'b1', processing_status: 'in_progress' })
  )
  let sent = await b.submit([{ custom_id: 's1', params: { model: 'm' } }])
  equal(sent.id, 'b1')
  equal(asked, [
    'POST https://api.anthropic.com/v1/messages/batches {"requests":[{"custom_id":"s1","params":{"model":"m"}}]}',
  ])
})

test("a batch's results are its lines, each one result", async () => {
  let line = (id: string) =>
    JSON.stringify({ custom_id: id, result: { type: 'expired' } })
  let { asked, api: b } = api(() =>
    new Response(`${line('s1')}\n${line('s2')}\n`)
  )
  equal((await b.results('b1')).map((r) => r.custom_id), ['s1', 's2'])
  equal(asked, ['GET https://api.anthropic.com/v1/messages/batches/b1/results'])
})
