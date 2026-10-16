import { claudeDoc } from './vocab.ts'
/**
 * Claude Code as a one-turn @yaks/model implementation. The MCP server only
 * advertises tools: calls are returned to the harness, never executed here.
 * Each request replays graph history; no Claude conversation is authoritative.
 * @module
 */
import {
  acknowledged,
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
      req.input || req.items.some((i) => i.kind == 'image') ||
      req.modalities?.some((m) => m != 'text')
    ) {
      throw new ModelError(
        'claude_input',
        'Claude Code provider supports text and harness tools only',
      )
    }
    req.signal?.throwIfAborted()
    let bridge = offer(req.tools)
    let cwd = await Deno.makeTempDir({ prefix: 'yak-claude-' })
    let child: Deno.ChildProcess | undefined
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
      child = new Deno.Command(opts.command ?? 'claude', {
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
      let reply: Reply | undefined
      let session = ''
      let terminal = false
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
      try {
        while (true) {
          let { value, done } = await reader.read()
          if (done) break
          let frame = JSON.parse(value!)
          if (frame.session_id && !session) {
            session = frame.session_id
            await acknowledged(req, { claude: { session_id: session } })
          }
          if (frame.type == 'assistant') {
            if (reply && reply.id != frame.message?.id) {
              throw new ModelError(
                'claude_protocol',
                'More than one model turn',
              )
            }
            if (frame.error) throw new ModelError('claude', String(frame.error))
            let message = frame.message
            let prior = reply?.items ?? []
            let output = items(message, req)
            let u = message.usage ?? {}
            let cached = u.cache_read_input_tokens ?? 0
            let totalInput = (u.input_tokens ?? 0) + cached +
              (u.cache_creation_input_tokens ?? 0)
            reply = {
              id: String(message.id),
              model: message.model ?? req.model,
              items: [...prior, ...output],
              usage: {
                input_tokens: totalInput,
                output_tokens: u.output_tokens ?? 0,
                total_tokens: totalInput + (u.output_tokens ?? 0),
                cached_tokens: cached,
              },
            }
            for (let [index, item] of output.entries()) {
              if (item.kind == 'assistant') {
                req.onText?.({
                  index: prior.length + index,
                  id: item.id,
                  text: item.text,
                })
              }
            }
            if (output.some((i) => i.kind == 'call')) {
              kill()
              break
            }
          }
          if (frame.type == 'result') {
            terminal = true
            if (frame.is_error || frame.subtype != 'success') {
              throw new ModelError('claude', JSON.stringify(frame))
            }
          }
        }
      } finally {
        await reader.cancel()
        reader.releaseLock()
      }
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
      if (error instanceof Deno.errors.NotFound) {
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
      await Deno.remove(cwd, { recursive: true })
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
