import * as io from '@yaks/file/io'
import { command as processCommand } from '@yaks/process/command'
import { claudeDoc } from './vocab.ts'
/**
 * Claude Code as a one-turn @yaks/model implementation. The MCP server only
 * advertises tools: calls are returned to the harness, never executed here.
 * Each request replays graph history; no Claude conversation is authoritative.
 * @module
 */
import {
  acknowledged,
  began,
  type Item,
  type Listed,
  type Model,
  ModelError,
  type Reply,
  type Request,
  submitted,
} from '@yaks/model'
import { offer } from './offer.ts'

/** Host override, chiefly for deterministic CLI contract tests. */
export type Options = { command?: string; args?: string[] }

/** CLI aliases are resolved by the installed Claude Code, not pinned releases. */
export let listing = (): Listed[] =>
  ['haiku', 'sonnet', 'opus'].map((name) => ({
    name,
    label: `Claude Code ${name}`,
    modalities: ['text'],
  }))

/** Full graph history is data in one stream-json user message, not --resume. */
export let input = (req: Request): string =>
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: JSON.stringify({ transcript: req.items }),
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

/** What the frames of one turn came to. `terminal` says the CLI reported a
 * successful result, which a turn ended by a call never reaches. */
export type Turn = { reply?: Reply; session: string; terminal: boolean }

/**
 * Read one turn from the CLI's frames. Text reaches `onText` as its
 * `stream_event` deltas arrive, at its place among the reply's assistant
 * items; each completed assistant frame then adds its items to the reply and
 * tells whatever of its text no delta carried, so the text told is always the
 * reply's text. Reading stops at the first frame that requests a call.
 */
export let read = async (
  req: Request,
  frames: AsyncIterable<Frame> | Iterable<Frame>,
): Promise<Turn> => {
  let turn: Turn = { session: '', terminal: false }
  let id = ''
  // Content block index to its place among the assistant items.
  let place = new Map<number, number>()
  let told: string[] = []
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
    if (frame.type == 'stream_event') {
      let e = frame.event ?? {}
      if (e.type == 'message_start') id = String(e.message?.id)
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
      let u = message.usage ?? {}
      let cached = u.cache_read_input_tokens ?? 0
      let totalInput = (u.input_tokens ?? 0) + cached +
        (u.cache_creation_input_tokens ?? 0)
      turn.reply = {
        id,
        model: message.model ?? req.model,
        items: [...prior, ...output],
        usage: {
          input_tokens: totalInput,
          output_tokens: u.output_tokens ?? 0,
          total_tokens: totalInput + (u.output_tokens ?? 0),
          cached_tokens: cached,
        },
      }
      let at = prior.filter((i) => i.kind == 'assistant').length
      for (let item of output) {
        if (item.kind != 'assistant') continue
        tell(at, item.text.slice(told[at]?.length ?? 0))
        at++
      }
      if (output.some((i) => i.kind == 'call')) break
    }
    if (frame.type == 'result') {
      turn.terminal = true
      if (frame.is_error || frame.subtype != 'success') {
        throw new ModelError('claude', JSON.stringify(frame))
      }
    }
  }
  return turn
}

/** Start one Claude process per model request. Requires a signed-in local CLI. */
export let claude = (opts: Options = {}): Model =>
  Object.assign(async (req: Request): Promise<Reply> => {
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
    let bridge = offer(req.tools)
    let cwd = await io.makeTempDir({ prefix: 'yak-claude-' })
    let child:
      | ReturnType<ReturnType<typeof processCommand>['spawn']>
      | undefined
    let killed = false
    let kill = () => {
      if (child && !killed) {
        killed = true
        try {
          child.kill('SIGKILL')
        } catch { /* already exited */ }
      }
    }
    let stderr: Promise<string> | undefined
    try {
      let prompt = [
        'You are the model of a graph-native harness. The user message contains the authoritative transcript as JSON.',
        'Continue that transcript, responding to its latest user or tool result. Prior assistant/call/result items are history, not new requests.',
        'Use only the offered harness MCP tools. The graph harness executes your calls after this turn. Do not simulate tool results.',
        req.instructions ?? '',
      ].join('\n\n')
      req.signal?.throwIfAborted()
      await submitted(req)
      req.signal?.throwIfAborted()
      child = processCommand(opts.command ?? 'claude', {
        args: [
          ...opts.args ?? [],
          '-p',
          '--model',
          req.model,
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
          '--mcp-config',
          bridge.config,
          '--setting-sources',
          '',
          '--settings',
          '{"disableAllHooks":true}',
          '--disable-slash-commands',
          '--permission-mode',
          'dontAsk',
          '--allowedTools',
          'mcp__harness__*',
          '--system-prompt',
          prompt,
          ...req.effort ? ['--effort', req.effort] : [],
        ],
        cwd,
        stdin: 'piped',
        stdout: 'piped',
        stderr: 'piped',
        env: {
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
      }).spawn()
      req.signal?.addEventListener('abort', kill, { once: true })
      if (req.signal?.aborted) kill()
      // Drain stderr concurrently to avoid a full pipe blocking stdout.
      stderr = new Response(child.stderr).text().then((s) => s.slice(-8192))
      req.signal?.throwIfAborted()
      let writer = child.stdin.getWriter()
      await writer.write(new TextEncoder().encode(input(req)))
      await writer.close()
      if (req.signal?.aborted) kill()
      let buffer = ''
      let reader = child.stdout.pipeThrough(new TextDecoderStream())
        .pipeThrough(
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
        ).getReader()
      let frames = async function* (): AsyncGenerator<Frame> {
        try {
          while (true) {
            let { value, done } = await reader.read()
            if (done) return
            yield JSON.parse(value!)
          }
        } finally {
          await reader.cancel()
          reader.releaseLock()
        }
      }
      let { reply, session, terminal } = await read(req, frames())
      // Claude may already be dispatching the call: the harness runs it.
      if (reply?.items.some((i) => i.kind == 'call')) kill()
      let status = await child.status
      req.signal?.throwIfAborted()
      if (!reply || (!killed && (!status.success || !terminal))) {
        throw new ModelError(
          'claude_exit',
          await stderr || 'Claude ended without a completed turn',
        )
      }
      return Object.assign(reply, { claudeSession: session })
    } catch (error) {
      kill()
      if (io.isNotFound(error)) {
        throw new ModelError(
          'claude_missing',
          'Install and sign in to Claude Code on the harness host',
        )
      }
      throw error
    } finally {
      req.signal?.removeEventListener('abort', kill)
      kill()
      await child?.status
      await stderr
      await bridge.close()
      await io.remove(cwd, { recursive: true })
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
  })
