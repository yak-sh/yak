// Tools hosted by the first-party runner. Local commands start in the Session
// worktree with the same host authority as process-backed agents; Tasks calls
// use the in-process MCP registry with managed identity outside model input.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { resolve } from 'node:path'
import { childEnv } from './agent_env.ts'
import { rows } from './client.ts'
import { type IO, mcpServer } from './mcp.ts'

export type ToolDefinition = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: boolean
}

export type ToolOutcome = {
  output: string
  failed?: boolean
  facets?: Record<string, Record<string, unknown>>
}

export type ToolContext = { signal?: AbortSignal }

export type ToolHost = {
  tools: ToolDefinition[]
  call: (
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ) => Promise<ToolOutcome>
  close?: () => Promise<void>
}

let object = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let schema = (
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

let localDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    name: 'shell',
    description:
      'Run one Bash command on the host. The working directory defaults to the Session worktree.',
    parameters: schema({
      command: { type: 'string' },
      cwd: {
        type: ['string', 'null'],
        description:
          'Existing host directory. Relative paths start at the Session worktree.',
      },
      timeout_ms: {
        type: ['integer', 'null'],
        minimum: 100,
        maximum: 120000,
      },
    }, ['command', 'cwd', 'timeout_ms']),
    strict: true,
  },
  {
    type: 'function',
    name: 'apply_patch',
    description:
      'Apply a Codex patch on the host. Use the *** Begin Patch format. The working directory defaults to the Session worktree.',
    parameters: schema({
      diff: { type: 'string' },
      cwd: {
        type: ['string', 'null'],
        description:
          'Existing host directory. Relative paths start at the Session worktree.',
      },
      timeout_ms: {
        type: ['integer', 'null'],
        minimum: 100,
        maximum: 120000,
      },
    }, ['diff', 'cwd', 'timeout_ms']),
    strict: true,
  },
]

let text = (bytes: Uint8Array[], total: number, limit: number) => {
  let size = Math.min(total, limit)
  let joined = new Uint8Array(size)
  let at = 0
  for (let chunk of bytes) {
    let kept = chunk.subarray(0, Math.min(chunk.length, size - at))
    joined.set(kept, at)
    at += kept.length
    if (at == size) break
  }
  let value = new TextDecoder().decode(joined)
  return total > limit
    ? `${value}\n[… ${total - limit} output bytes omitted]`
    : value
}

let drain = async (stream: ReadableStream<Uint8Array>, limit: number) => {
  let chunks: Uint8Array[] = []
  let total = 0, kept = 0
  for await (let chunk of stream) {
    total += chunk.length
    if (kept < limit) {
      let part = chunk.slice(0, limit - kept)
      chunks.push(part)
      kept += part.length
    }
  }
  return text(chunks, total, limit)
}

let bounded = (value: unknown, fallback = 30_000) => {
  let n = Number(value ?? fallback)
  if (!Number.isInteger(n) || n < 100 || n > 120_000) {
    throw new Error('timeout_ms must be an integer from 100 to 120000')
  }
  return n
}

let words = (args: Record<string, unknown>, allowed: string[]) => {
  let alien = Object.keys(args).filter((name) => !allowed.includes(name))
  if (alien.length) {
    throw new Error(`unknown tool argument: ${alien.join(', ')}`)
  }
}

export type LocalToolOptions = {
  tree: string
  session?: string
  codex?: string
  outputLimit?: number
}

export let localTools = async (
  options: LocalToolOptions,
): Promise<ToolHost> => {
  let tree = await Deno.realPath(options.tree)
  let limit = Math.max(1024, options.outputLimit ?? 1024 * 1024)

  let run = async (
    command: string,
    args: string[],
    cwdValue: unknown,
    timeoutValue: unknown,
    stdin: string,
    context: ToolContext,
  ): Promise<ToolOutcome> => {
    if (context.signal?.aborted) throw context.signal.reason
    if (cwdValue != null && typeof cwdValue != 'string') {
      throw new Error('tool cwd must be text')
    }
    let rel = cwdValue ?? '.'
    let cwd = await Deno.realPath(resolve(tree, rel)).catch(() => '')
    if (!cwd) throw new Error('tool cwd does not exist')
    let timeout = bounded(timeoutValue)
    let child = new Deno.Command(command, {
      args,
      cwd,
      clearEnv: true,
      env: childEnv(options.session, tree),
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let writer = child.stdin.getWriter()
    if (stdin) await writer.write(new TextEncoder().encode(stdin))
    await writer.close()
    let timedOut = false
    let kill = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // It won the race and already exited.
      }
    }
    let timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeout)
    let abort = () => kill()
    context.signal?.addEventListener('abort', abort, { once: true })
    try {
      let [status, stdout, stderr] = await Promise.all([
        child.status,
        drain(child.stdout, limit),
        drain(child.stderr, limit),
      ])
      if (context.signal?.aborted) throw context.signal.reason
      if (timedOut) {
        stderr = `[timed out after ${timeout}ms]${stderr ? `\n${stderr}` : ''}`
      }
      return {
        output: stdout,
        failed: !status.success,
        facets: {
          exit: { code: status.code },
          ...stderr ? { stderr: { text: stderr } } : {},
        },
      }
    } finally {
      clearTimeout(timer)
      context.signal?.removeEventListener('abort', abort)
    }
  }

  return {
    tools: localDefinitions,
    call: async (name, args, context = {}) => {
      if (name == 'shell') {
        words(args, ['command', 'cwd', 'timeout_ms'])
        if (typeof args.command != 'string') {
          throw new Error('command is required')
        }
        return await run(
          '/bin/bash',
          ['-c', args.command],
          args.cwd,
          args.timeout_ms,
          '',
          context,
        )
      }
      if (name == 'apply_patch') {
        words(args, ['diff', 'cwd', 'timeout_ms'])
        if (typeof args.diff != 'string') throw new Error('diff is required')
        return await run(
          options.codex ?? Deno.env.get('TASKS_CODEX_BIN') ?? 'codex',
          ['--codex-run-as-apply-patch', args.diff],
          args.cwd,
          args.timeout_ms,
          '',
          context,
        )
      }
      throw new Error(`unknown local tool: ${name}`)
    },
  }
}

let resultText = (result: CallToolResult) => {
  let blocks = result.content.flatMap((
    part: CallToolResult['content'][number],
  ) => part.type == 'text' ? [part.text] : [])
  // MCP mirrors textual output into structuredContent for typed clients. The
  // model input is one transcript, so never append the mirror a second time.
  if (!blocks.length && result.structuredContent != null) {
    blocks.push(JSON.stringify(result.structuredContent, null, 2))
  }
  return blocks.join('\n')
}

let taskDefinitions = (listed: Tool[]): ToolDefinition[] => {
  let byName = new Map(listed.map((tool) => [tool.name, tool]))
  let make = (
    name: string,
    parameters: Record<string, unknown>,
    strict = true,
  ): ToolDefinition => {
    let tool = byName.get(name)
    if (!tool) throw new Error(`Tasks MCP tool unavailable: ${name}`)
    return {
      type: 'function',
      name,
      description: tool.description ?? name,
      parameters,
      strict,
    }
  }
  return [
    make('task_context', schema({})),
    make('graph_query', schema({ query: { type: 'string' } }, ['query'])),
    make(
      'graph_apply',
      schema({
        change: {
          type: 'object',
          properties: {
            eid: { type: 'string' },
            name: { type: 'string' },
            comp: { type: ['object', 'null'], additionalProperties: true },
          },
          required: ['eid', 'name', 'comp'],
          additionalProperties: false,
        },
      }, ['change']),
      false,
    ),
  ]
}

// The provider gets only the three durable Tasks primitives accepted by
// D-15656. MCP sugar remains available through native doors; every hosted call
// here has a typed entry facet from which crash recovery can redispatch it.
export let tasksTools = async (io: IO, session: string): Promise<ToolHost> => {
  let identity = String(
    rows(await io.read()).find((row) => row.eid == session)?.comps.session
      ?.id ?? session,
  )
  let [mine, theirs] = InMemoryTransport.createLinkedPair()
  let server = mcpServer(io)
  let client = new Client({ name: 'tasks-runner', version: '0.1.0' })
  await server.connect(theirs)
  await client.connect(mine)
  let tools = taskDefinitions((await client.listTools()).tools)
  return {
    tools,
    call: async (name, args) => {
      words(
        args,
        name == 'task_context'
          ? []
          : [name == 'graph_apply' ? 'change' : 'query'],
      )
      let call = name == 'task_context'
        ? { name, arguments: { session: identity } }
        : name == 'graph_query'
        ? { name, arguments: { query: args.query } }
        : name == 'graph_apply'
        ? { name, arguments: { changes: [args.change], session } }
        : undefined
      if (!call) throw new Error(`unknown Tasks tool: ${name}`)
      if (name == 'graph_apply' && !object(args.change)) {
        throw new Error('change is required')
      }
      let result = await client.callTool(call) as CallToolResult
      return { output: resultText(result), failed: !!result.isError }
    },
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

export let combineTools = (...hosts: ToolHost[]): ToolHost => {
  let owners = new Map<string, ToolHost>()
  for (let host of hosts) {
    for (let tool of host.tools) {
      if (owners.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`)
      owners.set(tool.name, host)
    }
  }
  return {
    tools: hosts.flatMap((host) => host.tools),
    call: async (name, args, context) => {
      let host = owners.get(name)
      if (!host) throw new Error(`unknown tool: ${name}`)
      return await host.call(name, args, context)
    },
    close: async () => {
      for (let host of hosts.toReversed()) await host.close?.()
    },
  }
}
