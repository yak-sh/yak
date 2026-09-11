import { assertEquals, assertStringIncludes } from '@std/assert'
import { body, items, responses } from './responses.ts'

Deno.test('hosted web search composes with function tools', () => {
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

Deno.test('web citations are visible links; hosted actions are not local function calls', () => {
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

Deno.test('OAuth requests offer web tools by default and allow explicit disable', async () => {
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
