/** Replay one recorded request of a Claude Code transcript to its model.
 *
 * Run: deno run -A bench/replay.ts <transcript.jsonl> <line> <out.json>
 * [--variant variant.json] [--count] [--dry]
 *
 * Claude Code records every request it sends in its transcript: an
 * `api-request` line names the request's shape (`api-request-shape`: the
 * system prompt and tools) and its messages, as a base request's first `keep`
 * messages plus a tail of message hashes (`api-request-blob`). The request
 * replayed is the last main-thread one before `line`, so `line` is the first
 * line of the response whose reading is in question.
 *
 * Some messages have no blob (most assistant turns, some tool results). Those
 * are filled from the CLI's own rebuild of the transcript: `claude -p
 * --resume` of a copy cut before `line`, kept outside every directory the
 * box's transcript collector reads and run with no persistence, no tools, no
 * settings and no MCP servers. A local pass-through proxy puts the recorded
 * request in place of the CLI's first one and keeps the response, which never
 * reaches the CLI, so nothing in a reply runs. Only the body and its beta
 * header change; the CLI's own sign-in passes through, unread.
 *
 * `--count` asks only how many tokens the rebuilt request is (no reply), to
 * check it against the `usage` the original response recorded. `--dry` prints
 * the rebuild without starting the CLI. A variant is a list of
 * `{ in: 'system' | 'messages', from, to }`, each replacing text wherever it
 * reads, also inside a JSON tool result.
 * @module
 */
// Transcript lines and API bodies are JSON of the CLI's and the API's shapes.
// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>

/** The request recorded before `at` (a 1-based line), with its messages; a
 * message with no blob is `undefined`. */
export let rebuild = (lines: string[], at: number) => {
  let reqs = new Map<string, Rec>()
  let blobs = new Map<string, unknown>()
  let shapes = new Map<string, Rec>()
  let chosen: Rec | undefined
  // Blobs and shapes are named by their content, so any line may hold one.
  for (let [i, l] of lines.entries()) {
    if (!l.startsWith('{"type":"api-request')) continue
    let b = JSON.parse(l)
    if (b.type == 'api-request' && i + 1 < at) {
      reqs.set(b.id, b)
      if (['repl_main_thread', 'sdk'].includes(b.querySource)) chosen = b
    }
    if (b.type == 'api-request-blob') blobs.set(b.hash, b.message)
    if (b.type == 'api-request-shape') shapes.set(b.shapeHash, b.shape)
  }
  if (!chosen) throw new Error('no request before line ' + at)
  let hashes = (r: Rec): string[] => [
    ...(r.base ? hashes(reqs.get(r.base)!).slice(0, r.keep) : []),
    ...r.tail,
  ]
  let shape = shapes.get(chosen.shapeHash)
  if (!shape) throw new Error('no shape ' + chosen.shapeHash)
  let { betas, ...params } = chosen.params
  let body: Rec = {
    ...params,
    system: structuredClone(shape.system),
    tools: structuredClone(shape.tools),
    messages: hashes(chosen).map((h) => structuredClone(blobs.get(h))),
    stream: true,
  }
  for (let { path, value } of chosen.cacheControl ?? []) {
    let to: Rec = body
    for (let k of path) to = to?.[k]
    if (to && typeof to == 'object') to.cache_control = value
  }
  return { request: chosen as Rec, betas: betas as string[], body }
}

/** `x` with `from` replaced by `to` wherever it reads, as written and as it
 * reads inside a JSON string; a thinking block's signature is left alone. */
export let swap = (x: unknown, from: string, to: string): [unknown, number] => {
  let n = 0
  let walk = (y: unknown): unknown => {
    if (typeof y == 'string') {
      let escaped = JSON.stringify(from).slice(1, -1)
      let pairs = [[from, to]]
      if (escaped != from) {
        pairs.push([escaped, JSON.stringify(to).slice(1, -1)])
      }
      let s = y
      for (let [a, b] of pairs) {
        n += s.split(a).length - 1
        s = s.replaceAll(a, b)
      }
      return s
    }
    if (Array.isArray(y)) return y.map(walk)
    if (y && typeof y == 'object') {
      return Object.fromEntries(
        Object.entries(y).map(([k, v]) => [k, k == 'signature' ? v : walk(v)]),
      )
    }
    return y
  }
  return [walk(x), n]
}

export type Variant = { in: 'system' | 'messages'; from: string; to: string }

/** Each tool_result that loaded deferred tools, by its call: the CLI, offering
 * no tools, renders one as text, where the original sent tool_reference
 * blocks that load each tool's schema. */
export let loaded = (lines: string[]): Map<string, unknown> => {
  let out = new Map<string, unknown>()
  for (let l of lines) {
    if (!l.includes('"tool_reference"') || !l.includes('"type":"user"')) {
      continue
    }
    for (let c of JSON.parse(l).message?.content ?? []) {
      if (
        c.type == 'tool_result' && Array.isArray(c.content) &&
        c.content.some((x: Rec) => x.type == 'tool_reference')
      ) out.set(c.tool_use_id, c.content)
    }
  }
  return out
}

/** The recorded messages, each hole filled from the CLI's rebuild `cli`
 * (wearing the variants, and with loaded tools restored), and how the two
 * compare where both have a message. */
export let merge = (
  recorded: (Rec | undefined)[],
  cli: Rec[],
  variants: Variant[] = [],
  tools: Map<string, unknown> = new Map(),
) => {
  let check = { filled: 0, compared: 0, differ: 0, parted: -1, swapped: 0 }
  let bare = (m: unknown) =>
    JSON.stringify(m, (k, v) => k == 'cache_control' ? undefined : v)
  let messages = recorded.map((m, i) => {
    if (m) {
      if (i < cli.length - 1) {
        check.compared++
        if (m.role != cli[i]?.role && check.parted < 0) check.parted = i
        if (bare(m) != bare(cli[i])) check.differ++
      }
      return m
    }
    let c = cli[i]
    if (!c) throw new Error(`hole ${i} has no message in the CLI rebuild`)
    if (check.parted >= 0) {
      throw new Error(`hole ${i} after the rebuilds part at ${check.parted}`)
    }
    if (i == recorded.length - 1) {
      // the request's last message: the CLI adds its own prompt to it
      let results = Array.isArray(c.content)
        ? c.content.filter((b: Rec) => b.type == 'tool_result')
        : []
      if (!results.length) throw new Error('the last hole is no tool result')
      c = { ...c, content: results }
    } else if (i >= cli.length - 1) {
      throw new Error(`hole ${i} is the CLI's own prompt`)
    }
    check.filled++
    for (let v of variants) {
      if (v.in != 'messages') continue
      let [swapped, n] = swap(c, v.from, v.to)
      c = swapped as Rec
      check.swapped += n
    }
    if (!Array.isArray(c.content)) return c
    let content = c.content.map((b: Rec) =>
      b.type == 'tool_result' && tools.has(b.tool_use_id)
        ? { ...b, content: structuredClone(tools.get(b.tool_use_id)) }
        : b
    )
    let restored = content.some((b: Rec) =>
      b.type == 'tool_result' && tools.has(b.tool_use_id)
    )
    if (
      restored &&
      !content.some((b: Rec) => b.type == 'text' && b.text == 'Tool loaded.')
    ) content.push({ type: 'text', text: 'Tool loaded.' })
    return { ...c, content }
  })
  return { messages, check }
}

/** The reply a streamed response carries: its text, tool calls and
 * thinking, in order, and its usage. */
export let read = (events: string) => {
  let blocks: Rec[] = []
  let usage: Rec = {}
  for (let line of events.split('\n')) {
    if (!line.startsWith('data: ')) continue
    let e = JSON.parse(line.slice(6))
    if (e.type == 'message_start') usage = { ...e.message.usage }
    if (e.type == 'message_delta') {
      usage = { ...usage, ...e.usage, stop: e.delta?.stop_reason }
    }
    if (e.type == 'content_block_start') {
      blocks[e.index] = { ...e.content_block, json: '' }
    }
    if (e.type == 'content_block_delta') {
      let b = blocks[e.index], d = e.delta
      if (d.type == 'text_delta') b.text = (b.text ?? '') + d.text
      if (d.type == 'input_json_delta') b.json += d.partial_json
      if (d.type == 'thinking_delta') {
        b.thinking = (b.thinking ?? '') + d.thinking
      }
    }
  }
  let reply = blocks.filter(Boolean).map((b) =>
    b.type == 'tool_use'
      ? {
        type: 'tool_use',
        name: b.name,
        input: b.json ? JSON.parse(b.json) : b.input,
      }
      : b.type == 'text'
      ? { type: 'text', text: b.text }
      : b.type == 'thinking'
      ? { type: 'thinking', thinking: b.thinking ?? '' }
      : { type: b.type }
  )
  return { reply, usage }
}

/** The transcript cut before `at`, for the CLI to resume: no request records,
 * and its own session id. */
export let cut = (lines: string[], at: number, from: string, to: string) =>
  lines.slice(0, at - 1).filter((l) => !l.startsWith('{"type":"api-request"'))
    .map((l) => l.replaceAll(`"sessionId":"${from}"`, `"sessionId":"${to}"`))
    .join('\n') + '\n'

if (import.meta.main) {
  let [file, lineArg, out] = Deno.args
  let flag = (n: string) => {
    let i = Deno.args.indexOf('--' + n)
    return i < 0 ? undefined : Deno.args[i + 1]
  }
  let at = Number(lineArg)
  let lines = (await Deno.readTextFile(file)).split('\n')
  let { request, betas, body } = rebuild(lines, at)
  let variants: Variant[] = flag('variant')
    ? JSON.parse(await Deno.readTextFile(flag('variant')!))
    : []
  let swaps: number[] = []
  let holes = body.messages.some((m: unknown) => !m)
  for (let v of variants) {
    let [swapped, n] = swap(body[v.in], v.from, v.to)
    // a text only in a hole is checked when the hole is filled
    if (!n && (v.in != 'messages' || !holes)) {
      throw new Error('variant text not found: ' + v.from.slice(0, 80))
    }
    body[v.in] = swapped
    swaps.push(n)
  }
  if (Deno.args.includes('--dry')) {
    console.log(JSON.stringify({
      request: request.id,
      at: request.timestamp,
      model: body.model,
      messages: body.messages.length,
      holes: body.messages.filter((m: unknown) => !m).length,
      swaps,
    }))
    Deno.exit(0)
  }
  let tools = loaded(lines)
  let scratch = await Deno.makeTempDir({ prefix: 'replay-' })
  let copy = ''
  if (holes) {
    let id = crypto.randomUUID()
    copy = `${scratch}/${id}.jsonl`
    await Deno.writeTextFile(copy, cut(lines, at, request.sessionId, id))
  }
  let check: Rec = {}
  let events = ''
  let done = Promise.withResolvers<void>()
  let taken = false
  let count = Deno.args.includes('--count')
  let serve = async (req: Request): Promise<Response> => {
    let url = new URL(req.url)
    let headers = new Headers(req.headers)
    headers.delete('host')
    headers.delete('content-length')
    let payload: BodyInit | null = req.body ? await req.arrayBuffer() : null
    // Once the replay is sent, the CLI asks nothing more of a model: a 4xx
    // is not retried.
    let refused = new Response(
      '{"type":"error","error":{"type":"invalid_request_error","message":"replayed"}}',
      { status: 400 },
    )
    if (taken && url.pathname == '/v1/messages') return refused
    let theirs = !taken && req.method == 'POST' &&
        url.pathname == '/v1/messages' && payload
      ? JSON.parse(new TextDecoder().decode(payload as ArrayBuffer))
      : undefined
    if (theirs?.model != body.model || !Array.isArray(theirs?.messages)) {
      return fetch('https://api.anthropic.com' + url.pathname + url.search, {
        method: req.method,
        headers,
        body: payload,
      })
    }
    taken = true
    let merged = merge(body.messages, theirs.messages, variants, tools)
    check = merged.check
    let own = (headers.get('anthropic-beta') ?? '').split(',')
      .map((s) => s.trim()).filter(Boolean)
    headers.set('anthropic-beta', [...new Set([...betas, ...own])].join(','))
    let sent: Rec = { ...body, messages: merged.messages }
    if (count) {
      // only the context is counted, not how a reply would be made
      let rest = Object.fromEntries(
        Object.entries(sent).filter(([k]) =>
          ['model', 'system', 'tools', 'messages'].includes(k)
        ),
      )
      let r = await fetch(
        'https://api.anthropic.com/v1/messages/count_tokens',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(rest),
        },
      )
      events = `COUNT ${r.status} ${await r.text()}`
    } else {
      let r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(sent),
      })
      events = `HTTP ${r.status}\n${await r.text()}`
    }
    done.resolve()
    // The reply never reaches the CLI, so nothing in it runs.
    return refused
  }
  let server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen() {} },
    (req) =>
      serve(req).catch((e) => {
        done.reject(e)
        return new Response('{}', { status: 500 })
      }),
  )
  let cwd = `${scratch}/cwd`
  await Deno.mkdir(cwd)
  let child = new Deno.Command('claude', {
    args: [
      '-p',
      'Continue.',
      '--no-session-persistence',
      '--tools',
      '',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--model',
      body.model,
      ...(copy ? ['--resume', copy] : []),
    ],
    cwd,
    env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.addr.port}` },
    stdin: 'null',
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
  let failed = ''
  let timer = setTimeout(() => done.reject(new Error('timeout')), 600_000)
  await Promise.race([
    done.promise,
    child.status.then(async () => {
      if (!taken) throw new Error('the CLI exited before its request')
      await done.promise
    }),
  ]).catch((e) => failed = String(e))
  clearTimeout(timer)
  try {
    child.kill()
  } catch { /* exited */ }
  let err = await new Response(child.stderr).text().catch(() => '')
  await server.shutdown()
  await Deno.remove(scratch, { recursive: true })
  // Claude Code makes an empty memory folder for any directory it starts in.
  let home = Deno.env.get('HOME')
  await Deno.remove(
    `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`,
    { recursive: true },
  ).catch(() => {})
  if (count) {
    console.log(events)
    Deno.exit(0)
  }
  let { reply, usage } = read(events)
  await Deno.writeTextFile(
    out,
    JSON.stringify(
      {
        request: request.id,
        variant: flag('variant'),
        swaps,
        check,
        failed,
        status: events.split('\n')[0],
        usage,
        reply,
        err: err.slice(-2000),
      },
      null,
      2,
    ),
  )
  console.log(out, failed || events.split('\n')[0], JSON.stringify(usage))
}
