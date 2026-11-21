import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { body, items, responses } from './responses.ts'

test('hosted web search composes with function tools', () => {
  const req = {
    model: 'test',
    items: [],
    tools: [{ name: 'echo', description: '', parameters: {} }],
  }
  assertEquals((body(req, false, undefined, true).tools as unknown[]).length, 2)
  assertEquals((body(req, false, undefined, true).tools as unknown[])[1], {
    type: 'web_search',
  })
  assertEquals(
    (body(req, false, undefined, false).tools as unknown[]).length,
    1,
  )
})

test('web citations are visible links; hosted actions are not local function calls', () => {
  const result = items([
    {
      type: 'web_search_call',
      id: 'ws1',
      status: 'completed',
      action: { type: 'open_page', url: 'https://example.com' },
    },
    {
      type: 'message',
      content: [{
        type: 'output_text',
        text: 'Answer.',
        annotations: [
          {
            type: 'url_citation',
            url: 'https://example.com/page',
            title: 'Source',
          },
          { type: 'url_citation', url: 'javascript:bad', title: 'bad' },
        ],
      }],
    },
  ])
  assertEquals(result.length, 1)
  assertEquals(result[0].kind, 'assistant')
  assertStringIncludes(
    JSON.stringify(result),
    '[Source](<https://example.com/page>)',
  )
  assertEquals(JSON.stringify(result).includes('javascript:'), false)
})

test('OAuth requests offer web tools by default and allow explicit disable', async () => {
  for (const web of [undefined, false]) {
    let sent: Record<string, unknown> = {}
    const model = responses({
      credential: () => ({
        token: 'test',
        account: 'account',
        base: 'https://chatgpt.com/backend-api/codex',
      }),
      web,
      fetch: (_url, init) => {
        sent = JSON.parse(String(init?.body))
        const output = [{
          type: 'message',
          content: [{ type: 'output_text', text: 'answer' }],
        }]
        return Promise.resolve(
          new Response(
            [
              'data: ' +
              JSON.stringify({
                type: 'response.output_item.done',
                item: output[0],
              }),
              'data: ' +
              JSON.stringify({
                type: 'response.completed',
                response: {
                  id: 'r1',
                  model: 'test',
                  status: 'completed',
                  output,
                },
              }),
              'data: [DONE]',
            ].join('\n\n') + '\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        )
      },
    })
    await model({ model: 'test', items: [], tools: [] })
    assertEquals(
      (sent.tools as { type: string }[]).some((t) => t.type == 'web_search'),
      web !== false,
    )
  }
})

test('a request held to sites searches only their domains', () => {
  const req = { model: 'test', items: [], tools: [], sites: ['example.com'] }
  assertEquals(body(req, false, undefined, true).tools, [
    { type: 'web_search', filters: { allowed_domains: ['example.com'] } },
  ])
})

test('each hosted search is counted in the reply usage, a page opened is not', async () => {
  const output = [
    { type: 'web_search_call', action: { type: 'search', query: 'q' } },
    { type: 'web_search_call', action: { type: 'search', query: 'r' } },
    { type: 'web_search_call', action: { type: 'open_page', url: 'u' } },
    { type: 'message', content: [{ type: 'output_text', text: 'answer' }] },
  ]
  const model = responses({
    credential: () => ({ token: 'test', base: 'https://api.openai.com/v1' }),
    web: true,
    fetch: () =>
      Promise.resolve(
        new Response(
          [
            ...output.map((item) =>
              'data: ' +
              JSON.stringify({ type: 'response.output_item.done', item })
            ),
            'data: ' + JSON.stringify({
              type: 'response.completed',
              response: {
                id: 'r1',
                model: 'test',
                status: 'completed',
                output,
                usage: { input_tokens: 5, output_tokens: 1 },
              },
            }),
            'data: [DONE]',
          ].join('\n\n') + '\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
  })
  const reply = await model({ model: 'test', items: [], tools: [] })
  assertEquals(reply.usage?.web_searches, 2)
  assertEquals(reply.usage?.input_tokens, 5)
})

test('a page the text links already, or cited with no title, is linked once by its host', () => {
  let readme =
    'https://raw.githubusercontent.com/yak-sh/yak/main/packages/README.md'
  let cite = (text: string, title: string) =>
    items([{
      type: 'message',
      content: [{
        type: 'output_text',
        text,
        annotations: [{ type: 'url_citation', url: readme, title }],
      }],
    }])[0]
  assertEquals(
    cite(`As tasks. ([raw.githubusercontent.com](${readme}))`, ''),
    {
      kind: 'assistant',
      text: `As tasks. ([raw.githubusercontent.com](${readme}))`,
    },
  )
  assertEquals(cite('As tasks.', ''), {
    kind: 'assistant',
    text: `As tasks. [raw.githubusercontent.com](<${readme}>)`,
  })
})
