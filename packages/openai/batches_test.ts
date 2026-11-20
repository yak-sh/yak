// A batch is uploaded as one file of Responses requests, created on it, and
// read back from its output and error files.
import { equal, test } from '@yaks/testing'
import { batches } from './batches.ts'

let api = (answers: Record<string, () => Response>) => {
  let asked: string[] = []
  let files: string[] = []
  let fetch = async (url: string | URL | Request, init?: RequestInit) => {
    let path = String(url).replace('https://api.openai.com/v1', '')
    asked.push(`${init?.method ?? 'GET'} ${path}`)
    let body = init?.body
    if (body instanceof FormData) {
      files.push(await (body.get('file') as Blob).text())
    } else if (body) files.push(String(body))
    return answers[path]()
  }
  return {
    asked,
    files,
    api: batches({ fetch: fetch as typeof globalThis.fetch, key: () => 'k' }),
  }
}

test('a batch is a file of Responses requests, sharing their cache key', async () => {
  let { asked, files, api: b } = api({
    '/files': () => Response.json({ id: 'f1' }),
    '/batches': () => Response.json({ id: 'b1', status: 'validating' }),
  })
  let id = await b.submit([
    { id: 's1', model: 'm', system: 'S', text: 'T', max: 9, cache: 'c' },
  ])
  equal(id, 'b1')
  equal(asked, ['POST /files', 'POST /batches'])
  equal(JSON.parse(files[0]), {
    custom_id: 's1',
    method: 'POST',
    url: '/v1/responses',
    body: {
      model: 'm',
      instructions: 'S',
      input: 'T',
      max_output_tokens: 9,
      store: false,
      prompt_cache_key: 'c',
    },
  })
  equal(JSON.parse(files[1]), {
    input_file_id: 'f1',
    endpoint: '/v1/responses',
    completion_window: '24h',
  })
})

test("a batch's answers are its output and error files' lines", async () => {
  let ok = {
    custom_id: 's1',
    response: {
      status_code: 200,
      body: {
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'hi' }],
        }],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    },
  }
  let bad = {
    custom_id: 's2',
    response: { status_code: 400, body: { error: { message: 'too long' } } },
  }
  let { api: b } = api({
    '/batches/b1': () =>
      Response.json({
        id: 'b1',
        status: 'completed',
        output_file_id: 'o',
        error_file_id: 'e',
      }),
    '/files/o/content': () => new Response(JSON.stringify(ok) + '\n'),
    '/files/e/content': () => new Response(JSON.stringify(bad) + '\n'),
  })
  equal(await b.ended('b1'), true)
  equal(await b.results('b1'), [
    {
      id: 's1',
      text: 'hi',
      usage: {
        input_tokens: 3,
        cached_tokens: 0,
        output_tokens: 2,
        reasoning_tokens: 0,
      },
    },
    { id: 's2', error: '400: too long' },
  ])
})
