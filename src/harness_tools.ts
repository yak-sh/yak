// Tools hosted by the first-party runner. Local commands start in the Session
// worktree with the same host authority as process-backed agents; Tasks calls
// use the in-process MCP registry with managed identity outside model input.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { resolve } from 'node:path'
import { childEnv } from './agent_env.ts'
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
  return new TextDecoder().decode(joined)
}

type Drained = { text: string; total: number; file?: string }

let write = async (file: Deno.FsFile, bytes: Uint8Array) => {
  let at = 0
  while (at < bytes.length) at += await file.write(bytes.subarray(at))
}

let drain = async (
  stream: ReadableStream<Uint8Array>,
  limit: number,
  name: string,
): Promise<Drained> => {
  let chunks: Uint8Array[] = []
  let total = 0,
    kept = 0,
    file: Deno.FsFile | undefined,
    path: string | undefined
  try {
    for await (let chunk of stream) {
      total += chunk.length
      if (kept < limit) {
        let part = chunk.slice(0, limit - kept)
        chunks.push(part)
        kept += part.length
      }
      if (!file && total > limit) {
        path = await Deno.makeTempFile({
          prefix: `tasks-${name}-`,
          suffix: '.log',
        })
        file = await Deno.open(path, { write: true })
        for (let part of chunks) await write(file, part)
        let rest = chunk.subarray(Math.max(0, chunk.length - (total - limit)))
        if (rest.length) await write(file, rest)
      } else if (file) {
        await write(file, chunk)
      }
    }
  } catch (error) {
    if (path) await Deno.remove(path).catch(() => {})
    throw error
  } finally {
    file?.close()
  }
  return {
    text: text(chunks, total, limit),
    total,
    ...path ? { file: path } : {},
  }
}

let shown = (drained: Drained, name: string) =>
  drained.file
    ? `${drained.text}\n[… full ${name} saved to ${drained.file} ` +
      `(${drained.total} bytes)]`
    : drained.text

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
  let limit = Math.max(1024, options.outputLimit ?? 100_000)

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
        drain(child.stdout, limit, 'stdout'),
        drain(child.stderr, limit, 'stderr'),
      ])
      if (context.signal?.aborted) {
        for (let path of [stdout.file, stderr.file]) {
          if (path) await Deno.remove(path).catch(() => {})
        }
        throw context.signal.reason
      }
      let stdoutText = shown(stdout, 'stdout')
      let stderrText = shown(stderr, 'stderr')
      if (timedOut) {
        stderrText = `[timed out after ${timeout}ms]` +
          `${stderrText ? `\n${stderrText}` : ''}`
      }
      return {
        output: stdoutText,
        failed: !status.success,
        facets: {
          exit: { code: status.code },
          ...stderrText ? { stderr: { text: stderrText } } : {},
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
  let publicSchema = (name: string) => {
    let tool = byName.get(name)
    if (!tool) throw new Error(`Tasks MCP tool unavailable: ${name}`)
    let input = structuredClone(tool.inputSchema) as Record<string, unknown>
    let properties = input.properties as Record<string, unknown> | undefined
    if (properties) delete properties.session
    let required = input.required as string[] | undefined
    if (required) {
      input.required = required.filter((field) => field != 'session')
    }
    return input
  }
  return [
    make('task_context', schema({})),
    make('graph_query', schema({ query: { type: 'string' } }, ['query'])),
    make(
      'graph_apply',
      publicSchema('graph_apply'),
      false,
    ),
  ]
}

// The provider gets only the three durable Tasks primitives accepted by
// D-15656. MCP sugar remains available through native doors; every hosted call
// here has a typed entry facet from which crash recovery can redispatch it.
export let tasksTools = async (io: IO, session: string): Promise<ToolHost> => {
  // This runs before every generation and hosted call. Identity is one entity;
  // taking a root snapshot here made each tool boundary walk the whole graph.
  let identity = String(
    (await io.get([session])).find((row) => row.eid == session)?.comps.session
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
          : name == 'graph_apply'
          ? ['changes', 'entities']
          : ['query'],
      )
      let call = name == 'task_context'
        ? { name, arguments: { session: identity } }
        : name == 'graph_query'
        ? { name, arguments: { query: args.query } }
        : name == 'graph_apply'
        ? { name, arguments: { ...args, session } }
        : undefined
      if (!call) throw new Error(`unknown Tasks tool: ${name}`)
      let batch = args.changes ?? args.entities
      if (
        name == 'graph_apply' &&
        ((args.changes == null) == (args.entities == null) ||
          !Array.isArray(batch) || !batch.length || !batch.every(object))
      ) {
        throw new Error(
          'graph_apply needs exactly one non-empty changes or entities array',
        )
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
