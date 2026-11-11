import * as io from '@yaks/file/io'
import { command as processCommand } from '@yaks/process/command'
import { claudeDoc } from './vocab.ts'
/**
 * Claude Code as a one-turn @yaks/model implementation. The MCP server it
 * hosts over the CLI's control channel only advertises tools: calls are
 * returned to the harness, never executed here.
 * Each request replays graph history; no Claude conversation is authoritative.
 * @module
 */
import {
  acknowledged,
  began,
  type Item,
  type Limit,
  type Listed,
  type Model,
  ModelError,
  type Reply,
  type Request,
  submitted,
  type Usage,
} from '@yaks/model'
import { metered } from './limits.ts'
import { offer } from './offer.ts'

/** Host override, chiefly for deterministic CLI contract tests. */
export type Options = {
  command?: string
  args?: string[]
  /** the account the CLI signs in with (@yaks/model `accountEid`), whose
   * plan the limits a reply carries are of */
  account?: string
}

/** CLI aliases are resolved by the installed Claude Code, not pinned releases. */
export let listing = (): Listed[] =>
  ['haiku', 'sonnet', 'opus'].map((name) => ({
    name,
    label: `Claude Code ${name}`,
    modalities: ['text'],
  }))

/** Full graph history is data in one stream-json user message, not --resume:
 * one text block per item, oldest first. The CLI marks the message's last
 * block for the prompt cache, and the next step's message begins with the same
 * blocks, so the cache finds this step's prefix there and only the items since
 * are read anew. One string of the whole transcript differs from the last
 * step's at its end, and the cache found none of it. */
export let input = (req: Request): string =>
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: req.items.map((item) => ({
        type: 'text',
        text: JSON.stringify(item),
      })),
    },
  }) + '\n'

/** The public text and tool requests of one completed assistant frame. */
export let items = (message: Record<string, unknown>, req: Request): Item[] => {
  if (!Array.isArray(message.content)) {
    throw new ModelError('claude_protocol', 'Missing assistant content')
  }
  return message.content.flatMap((p): Item[] => {
    if (p.type == 'text') {
      return [{ kind: 'assistant', text: p.text, id: String(message.id) }]
    }
    if (p.type == 'thinking' || p.type == 'redacted_thinking') return []
    if (p.type == 'tool_use') {
      let name = String(p.name).replace(/^mcp__harness__/, '')
      if (
        p.name != 'mcp__harness__' + name ||
        !req.tools.some((t) => t.name == name)
      ) {
        throw new ModelError(
          'claude_tool',
          `Claude requested an unoffered tool: ${p.name}`,
        )
      }
      return [{ kind: 'call', id: p.id, name, args: JSON.stringify(p.input) }]
    }
    throw new ModelError(
      'claude_protocol',
      `Unsupported assistant content: ${p.type}`,
    )
  })
}

/** One line of the CLI's stream-json output. */
// deno-lint-ignore no-explicit-any
export type Frame = Record<string, any>

/** A reply's usage from the API's usage fields, which count cache reads and
 * writes beside `input_tokens`; here they are parts of it. A write kept an
 * hour is priced apart from one kept five minutes, so it is counted apart. */
let counted = (u: Frame): Usage => {
  let cached = u.cache_read_input_tokens ?? 0
  let wrote = u.cache_creation_input_tokens ?? 0
  let hour = u.cache_creation?.ephemeral_1h_input_tokens
  let input = (u.input_tokens ?? 0) + cached + wrote
  let output = u.output_tokens ?? 0
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cached_tokens: cached,
    cache_write_tokens: wrote,
    ...hour ? { cache_write_1h_tokens: hour } : {},
  }
}

/** What the frames of one turn came to. `terminal` says the CLI reported a
 * successful result, which a turn ended by a call never reaches. */
export type Turn = {
  reply?: Reply
  session: string
  terminal: boolean
  /** each plan window's newest reading the stream gave (`rate_limit_event`) */
  limits: Limit[]
}

/**
 * Read one turn from the CLI's frames. Text reaches `onText` as its
 * `stream_event` deltas arrive, at its place among the reply's assistant
 * items; each completed assistant frame then adds its items to the reply and
 * tells whatever of its text no delta carried, so the text told is always the
 * reply's text. Usage is the count the message ended with, which its
 * `message_delta` carries; an `assistant` frame holds the count it started
 * with. A message that requests a call is read through its `message_delta`,
 * which the CLI writes before it dispatches the call, and reading stops there.
 * Otherwise it stops at the turn's `result`. The plan limits the stream
 * reports on the way are kept with the turn, and with the failure where the
 * turn ends in one.
 */
export let read = async (
  req: Request,
  frames: AsyncIterable<Frame> | Iterable<Frame>,
): Promise<Turn> => {
  let turn: Turn = { session: '', terminal: false, limits: [] }
  let id = ''
  // Content block index to its place among the assistant items.
  let place = new Map<number, number>()
  let told: string[] = []
  // The message's usage as last reported, newest fields winning.
  let usage: Frame = {}
  let tell = (index: number, text: string) => {
    if (!text) return
    told[index] = (told[index] ?? '') + text
    req.onText?.({ index, id, text })
  }
  for await (let frame of frames) {
    if (frame.session_id && !turn.session) {
      turn.session = frame.session_id
      await acknowledged(req, { claude: { session_id: turn.session } })
    }
    if (frame.type == 'rate_limit_event') {
      let read = metered(frame.rate_limit_info ?? {})
      turn.limits = [
        ...turn.limits.filter((l) => !read.some((r) => r.window == l.window)),
        ...read,
      ]
    }
    if (frame.type == 'stream_event') {
      let e = frame.event ?? {}
      if (e.type == 'message_start') {
        id = String(e.message?.id)
        usage = { ...e.message?.usage }
      }
      if (e.type == 'message_delta') {
        usage = { ...usage, ...e.usage }
        if (turn.reply) turn.reply.usage = counted(usage)
        if (turn.reply?.items.some((i) => i.kind == 'call')) break
      }
      if (e.type == 'content_block_start') {
        began(req)
        if (e.content_block?.type == 'text') place.set(e.index, place.size)
      }
      let at = place.get(e.index)
      if (e.delta?.type == 'text_delta' && at != null) tell(at, e.delta.text)
    }
    if (frame.type == 'assistant') {
      if (turn.reply && turn.reply.id != frame.message?.id) {
        throw new ModelError('claude_protocol', 'More than one model turn')
      }
      if (frame.error) throw new ModelError('claude', String(frame.error))
      began(req)
      let message = frame.message
      id = String(message.id)
      let prior = turn.reply?.items ?? []
      let output = items(message, req)
      // The frame's count is the message's start: never below a later one.
      usage = { ...message.usage, ...usage }
      turn.reply = {
        id,
        model: message.model ?? req.model,
        items: [...prior, ...output],
        usage: counted(usage),
      }
      let at = prior.filter((i) => i.kind == 'assistant').length
      for (let item of output) {
        if (item.kind != 'assistant') continue
        tell(at, item.text.slice(told[at]?.length ?? 0))
        at++
      }
    }
    if (frame.type == 'result') {
      turn.terminal = true
      if (frame.is_error || frame.subtype != 'success') {
        throw Object.assign(
          new ModelError('claude', JSON.stringify(frame)),
          turn.limits.length ? { limits: turn.limits } : {},
        )
      }
      break
    }
  }
  return turn
}

/** The CLI's arguments for one model at one effort. A step's prompt and tools
 * are not among them: they reach the process with the step (`opening`), so
 * the process can start before its step is known. Built-ins, settings, hooks,
 * slash commands and saved sessions are all off. */
export let argv = (model: string, effort?: string): string[] => [
  '-p',
  '--model',
  model,
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--max-turns',
  '1',
  '--no-session-persistence',
  '--tools',
  '',
  '--strict-mcp-config',
  '--setting-sources',
  '',
  '--settings',
  '{"disableAllHooks":true}',
  '--disable-slash-commands',
  '--permission-mode',
  'dontAsk',
  '--allowedTools',
  'mcp__harness__*',
  ...effort ? ['--effort', effort] : [],
]

/** The control request that opens a step: its system prompt, and the harness
 * as an SDK-hosted MCP server, which the CLI asks for its tools over the same
 * stdin and stdout (`offer`). */
export let opening = (req: Request): string =>
  JSON.stringify({
    type: 'control_request',
    request_id: crypto.randomUUID(),
    request: {
      subtype: 'initialize',
      systemPrompt: [[
        'You are the model of a graph-native harness. The user message contains the authoritative transcript, one JSON item per block, oldest first.',
        'Continue that transcript, responding to its latest user or tool result. Prior assistant/call/result items are history, not new requests.',
        'Use only the offered harness MCP tools. The graph harness executes your calls after this turn. Do not simulate tool results.',
        req.instructions ?? '',
      ].join('\n\n')],
      sdkMcpServers: ['harness'],
    },
  }) + '\n'

type Child = ReturnType<ReturnType<typeof processCommand>['spawn']>
/** A started CLI process and its empty working directory. */
type Proc = { child: Child; cwd: string; ended: boolean }

let start = async (opts: Options, model: string, effort?: string) => {
  let cwd = await io.makeTempDir({ prefix: 'yak-claude-' })
  let child = processCommand(opts.command ?? 'claude', {
    args: [...opts.args ?? [], ...argv(model, effort)],
    cwd,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
    env: {
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  }).spawn()
  let proc: Proc = { child, cwd, ended: false }
  let ended = () => {
    proc.ended = true
  }
  child.status.then(ended, ended)
  await child.started.catch(async (error) => {
    await io.remove(cwd, { recursive: true })
    throw error
  })
  // A process waiting for its step never holds its host open; it ends when
  // the host does, and its stdin with it.
  child.unref()
  return proc
}

let end = async (proc: Proc) => {
  // Its exit is waited for, so it holds the host open until then.
  proc.child.ref()
  proc.child.kill('SIGKILL')
  await proc.child.status.catch(() => {})
  await io.remove(proc.cwd, { recursive: true })
}

let lines = (stream: ReadableStream<Uint8Array<ArrayBuffer>>) => {
  let buffer = ''
  return stream.pipeThrough(new TextDecoderStream()).pipeThrough(
    new TransformStream<string, string>({
      transform(chunk, controller) {
        buffer += chunk
        let lines = buffer.split('\n')
        buffer = lines.pop()!
        for (let line of lines) if (line.trim()) controller.enqueue(line)
      },
      flush(controller) {
        if (buffer.trim()) controller.enqueue(buffer)
      },
    }),
  )
}

/**
 * Claude Code answering model requests, one CLI process per step. Requires a
 * signed-in local CLI. Each step takes a process started before it, for its
 * model and effort, and starts the next step's while it waits on the model,
 * so a step doesn't wait for the CLI to start. A process answers one step and
 * is ended: nothing one step sends reaches another's reply.
 */
export let claude = (opts: Options = {}): Model & AsyncDisposable => {
  // The process the next step of each model and effort takes.
  let spares = new Map<string, Promise<Proc | undefined>>()
  let key = (req: Request) => JSON.stringify([req.model, req.effort ?? null])
  let spare = (req: Request) => {
    if (spares.has(key(req))) return
    spares.set(
      key(req),
      start(opts, req.model, req.effort).catch(() => undefined),
    )
  }
  let accounted = (limits: Limit[]): Limit[] =>
    opts.account ? limits.map((l) => ({ ...l, account: opts.account })) : limits
  let take = async (req: Request) => {
    let held = spares.get(key(req))
    spares.delete(key(req))
    let proc = await held
    if (proc && !proc.ended) return proc
    if (proc) await end(proc)
    return await start(opts, req.model, req.effort)
  }
  return Object.assign(async (req: Request): Promise<Reply> => {
    if (req.questions) {
      throw new ModelError(
        'questions',
        'Claude Code answers no typed questions',
      )
    }
    if (
      req.input || req.items.some((i) => 'bytes' in i) ||
      req.modalities?.some((m) => m != 'text')
    ) {
      throw new ModelError(
        'claude_input',
        'Claude Code provider supports text and harness tools only',
      )
    }
    req.signal?.throwIfAborted()
    let tools = offer(req.tools)
    let proc: Proc | undefined
    let kill = () => proc?.child.kill('SIGKILL')
    let stderr: Promise<string> | undefined
    try {
      await submitted(req)
      req.signal?.throwIfAborted()
      proc = await take(req)
      let child = proc.child
      child.ref()
      req.signal?.addEventListener('abort', kill, { once: true })
      // Drain stderr concurrently to avoid a full pipe blocking stdout.
      stderr = new Response(child.stderr).text().then((s) => s.slice(-8192))
      let writer = child.stdin.getWriter()
      let send = (line: string) => writer.write(new TextEncoder().encode(line))
      await send(opening(req) + input(req))
      spare(req)
      let reader = lines(child.stdout).getReader()
      // The turn's frames; the control channel is answered here.
      let frames = async function* (): AsyncGenerator<Frame> {
        try {
          while (true) {
            let { value, done } = await reader.read()
            if (done) return
            let frame: Frame = JSON.parse(value!)
            if (frame.type == 'control_response') {
              if (frame.response?.subtype == 'error') {
                throw new ModelError('claude_protocol', frame.response.error)
              }
              continue
            }
            if (frame.type != 'control_request') {
              yield frame
              continue
            }
            let r = frame.request ?? {}
            let mcp = r.subtype == 'mcp_message' && r.server_name == 'harness'
              ? tools(r.message ?? {})
              : undefined
            // A call is never answered: the harness runs it.
            if (mcp == undefined && r.message?.method == 'tools/call') continue
            await send(
              JSON.stringify({
                type: 'control_response',
                response: mcp
                  ? {
                    subtype: 'success',
                    request_id: frame.request_id,
                    response: { mcp_response: mcp },
                  }
                  : {
                    subtype: 'error',
                    request_id: frame.request_id,
                    error: `Unsupported control request: ${r.subtype}`,
                  },
              }) + '\n',
            )
          }
        } finally {
          await reader.cancel()
          reader.releaseLock()
        }
      }
      let { reply, session, terminal, limits } = await read(req, frames())
      kill()
      req.signal?.throwIfAborted()
      if (!reply || (!terminal && !reply.items.some((i) => i.kind == 'call'))) {
        throw new ModelError(
          'claude_exit',
          await stderr || 'Claude ended without a completed turn',
        )
      }
      return Object.assign(reply, {
        claudeSession: session,
        ...limits.length ? { limits: accounted(limits) } : {},
      })
    } catch (error) {
      kill()
      if (error instanceof ModelError && error.limits) {
        error.limits = accounted(error.limits)
      }
      let failed = await proc?.child.status.then(() => {}, (e) => e)
      if (io.isNotFound(error) || io.isNotFound(failed)) {
        throw new ModelError(
          'claude_missing',
          'Install and sign in to Claude Code on the harness host',
        )
      }
      throw error
    } finally {
      req.signal?.removeEventListener('abort', kill)
      if (proc) await end(proc)
      await stderr?.catch(() => {})
    }
  }, {
    list: () => Promise.resolve(listing()),
    info: (name: string) =>
      Promise.resolve(listing().find((m) => m.name == name)),
    mark: (reply: Reply) => ({
      claude: {
        response_id: reply.id,
        session_id: (reply as Reply & { claudeSession?: string }).claudeSession,
      },
    }),
    vocab: claudeDoc,
    /** Ends the processes waiting for steps. */
    [Symbol.asyncDispose]: async () => {
      let held = [...spares.values()]
      spares.clear()
      for (let proc of await Promise.all(held)) if (proc) await end(proc)
    },
  })
}
