// Deterministic subprocess fixture: never starts Claude or spends a subscription.
let prompt = Deno.args[Deno.args.indexOf('--system-prompt') + 1]
let raw = await new Response(Deno.stdin.readable).text()
let transcript = JSON.parse(JSON.parse(raw).message.content).transcript
if (!prompt || Deno.args[Deno.args.indexOf('--tools') + 1] != '') {
  throw Error('unsafe flags')
}
if (
  !Deno.args.includes('--strict-mcp-config') ||
  !Deno.args.includes('--no-session-persistence')
) throw Error('unsafe flags')
let config = JSON.parse(Deno.args[Deno.args.indexOf('--mcp-config') + 1])
let url = config.mcpServers.harness.url
let list = await fetch(url, {
  method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}).then((r) => r.json())
let final = transcript.some((i: { kind: string }) => i.kind == 'result')
console.log(JSON.stringify({ type: 'system', session_id: 'fake-session' }))
// Claude can emit text and tool-use blocks as separate frames of one message.
if (!final) {
  console.log(
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'message-1',
        model: 'fake-model',
        usage: { input_tokens: 5, output_tokens: 1 },
        content: [{ type: 'text', text: 'checking' }],
      },
    }),
  )
}
console.log(JSON.stringify({
  type: 'assistant',
  message: {
    id: 'message-' + (final ? '2' : '1'),
    model: 'fake-model',
    usage: { input_tokens: 5, output_tokens: 3 },
    content: final ? [{ type: 'text', text: 'done' }] : [{
      type: 'tool_use',
      id: 'call-1',
      name: 'mcp__harness__' + list.result.tools[0].name,
      input: { q: 'hello' },
    }],
  },
}))
if (final) {
  console.log(
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
  )
} else await new Promise(() => {})
