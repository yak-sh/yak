// The gated compatibility canary for the non-public ChatGPT Responses path.
// The gate names a credential FILE; no token rides an environment or argv.
import { assertEquals } from '@std/assert'
import { Credential, responses } from './responses.ts'

let authFile = Deno.env.get('TASKS_CODEX_CANARY_AUTH')

let auth = (): Credential => {
  let value = JSON.parse(Deno.readTextFileSync(authFile!))
  return {
    token: value.tokens?.access_token,
    account: value.tokens?.account_id,
  }
}

Deno.test({
  name: 'live responses completes text and a correlated function call',
  ignore: !authFile,
  fn: async () => {
    let client = responses({
      base: 'https://chatgpt.com/backend-api/codex',
      credentials: { get: () => Promise.resolve(auth()) },
      headers: {
        originator: 'tasks',
        version: Deno.env.get('TASKS_CODEX_CANARY_VERSION') ?? '0',
      },
      retries: 0,
    })
    let tool = {
      type: 'function',
      name: 'proof_marker',
      description: 'Return the disposable transport marker.',
      parameters: {
        type: 'object',
        properties: {
          marker: { type: 'string', enum: ['tasks-transport'] },
        },
        required: ['marker'],
        additionalProperties: false,
      },
      strict: true,
    }
    let first = await client.run({
      model: 'gpt-5.6-sol',
      instructions: 'Call proof_marker exactly once.',
      input: [{ role: 'user', content: 'Run the transport canary.' }],
      tools: [tool],
      tool_choice: 'required',
      reasoning: { effort: 'low', summary: 'auto' },
    })
    let call = first.items.find((item) => item.type == 'function_call')!
    assertEquals(call.name, 'proof_marker')

    let second = await client.run({
      model: 'gpt-5.6-sol',
      instructions: 'After the tool result, reply with exactly CANARY_OK.',
      input: [
        ...first.items,
        {
          type: 'function_call_output',
          call_id: call.call_id,
          output: '{"ok":true}',
        },
      ],
      tools: [tool],
      tool_choice: 'none',
      reasoning: { effort: 'low', summary: 'auto' },
    })
    let text = second.items
      .flatMap((item) =>
        item.type == 'message' ? item.content as unknown[] : []
      )
      .filter((item) =>
        item != null && typeof item == 'object' &&
        (item as { type?: string }).type == 'output_text'
      )
      .map((item) => (item as { text?: string }).text ?? '')
      .join('')
    assertEquals(text.trim(), 'CANARY_OK')
  },
})
