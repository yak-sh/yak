// A stand-in for `claude -p` in stream-json mode, for mod_test.ts. It appends
// `boot <pid>` to the file its first argument names when it starts, lists its
// tools over the control channel when a step opens, and answers each user
// message with one text block: what this process has seen, as JSON. A message
// saying `please call` is answered with a call of its first tool, which it then
// dispatches and waits on, as the CLI does.

let log = Deno.args[0]
await Deno.writeTextFile(log, `boot ${Deno.pid}\n`, { append: true })
let encoder = new TextEncoder()
let emit = (frame: unknown) => {
  Deno.stdout.writeSync(encoder.encode(JSON.stringify(frame) + '\n'))
}
let pending = new Map<string, (response: unknown) => void>()
let ask = (message: unknown) => {
  let id = crypto.randomUUID()
  emit({
    type: 'control_request',
    request_id: id,
    request: { subtype: 'mcp_message', server_name: 'harness', message },
  })
  return new Promise<unknown>((resolve) => pending.set(id, resolve))
}
let seen: { prompt?: string; tools: string[]; users: unknown[] } = {
  tools: [],
  users: [],
}
let opened = async (
  frame: { request_id: string; request: { systemPrompt: string[] } },
) => {
  seen.prompt = frame.request.systemPrompt.join('')
  await ask({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} })
  let listed = await ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as {
    mcp_response: { result: { tools: { name: string }[] } }
  }
  seen.tools = listed.mcp_response.result.tools.map((t) => t.name)
  emit({
    type: 'control_response',
    response: { subtype: 'success', request_id: frame.request_id },
  })
}
let answer = (text: string) => {
  let message = { id: `message-${Deno.pid}`, model: 'fixture', usage: {} }
  emit({ type: 'system', subtype: 'init', session_id: `session-${Deno.pid}` })
  emit({
    type: 'stream_event',
    event: { type: 'message_start', message },
  })
  if (text.includes('please call')) {
    let call = {
      type: 'tool_use',
      id: 'call-1',
      name: `mcp__harness__${seen.tools[0]}`,
      input: {},
    }
    emit({ type: 'assistant', message: { ...message, content: [call] } })
    ask({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} })
    emit({ type: 'stream_event', event: { type: 'message_delta', usage: {} } })
    return
  }
  let content = [{
    type: 'text',
    text: JSON.stringify({ pid: Deno.pid, ...seen }),
  }]
  emit({ type: 'assistant', message: { ...message, content } })
  emit({ type: 'stream_event', event: { type: 'message_delta', usage: {} } })
  emit({ type: 'result', subtype: 'success' })
}
// A step's message is answered once its opening has listed the tools, which
// needs the host's answers from this same stdin.
let open = Promise.resolve()
let buffer = ''
for await (
  let chunk of Deno.stdin.readable.pipeThrough(new TextDecoderStream())
) {
  buffer += chunk
  let lines = buffer.split('\n')
  buffer = lines.pop()!
  for (let line of lines.filter((l) => l.trim())) {
    let frame = JSON.parse(line)
    if (frame.type == 'control_response') {
      pending.get(frame.response.request_id)?.(frame.response.response)
    }
    if (frame.request?.subtype == 'initialize') open = opened(frame)
    if (frame.type == 'user') {
      seen.users.push(
        ...frame.message.content.map((b: { text: string }) => b.text),
      )
      open = open.then(() => answer(line))
    }
  }
}
