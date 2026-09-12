import { and, eq } from '@yaks/query'
/** Recorded tool execution, independent of sessions and provider transports. */
import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  token,
  type Tool,
  type ToolCtx,
} from '@yaks/graph'
import { validateToolInput } from '@yaks/vocab/tools'
export { callDoc, toolDoc, toolsDoc } from './vocab.ts'

/** Expected invocation failures, not programming defects. */
export class CallError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'CallError'
  }
}

/** A durable start exists but no answer does. The host must reconcile it. */
export class UnfinishedCall extends Error {
  constructor(public call: Eid) {
    super('Call execution was started without a recorded result: ' + call)
    this.name = 'UnfinishedCall'
  }
}

export type Invocation = {
  inputSchema?: Record<string, unknown>
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>
  validate?: (args: Record<string, unknown>) => void
  format?: (value: unknown) => string
}

export type CallOptions = {
  /** Resolve against the registry snapshot chosen by the host. */
  resolve: (target: Eid, call: Bundle) => Invocation | undefined
  mint?: () => Eid
  report?: (error: unknown, call: Bundle) => void
}

/** Adapt the existing graph Tool contract, including legacy schema validators. */
export const graphInvocation = (tool: Tool, ctx: ToolCtx): Invocation => ({
  run: (args) => tool.run(args, ctx),
  inputSchema: tool.inputSchema,
  validate: (args) => {
    try {
      if (tool.inputSchema && tool.input) {
        throw new Error('Tool cannot declare both input and inputSchema')
      }
      if (!tool.inputSchema) {
        for (const [key, schema] of Object.entries(tool.input ?? {})) {
          const parser = schema as { parse?: (value: unknown) => unknown }
          if (!parser?.parse) {
            throw new Error('Legacy schema requires a parse adapter: ' + key)
          }
          args[key] = parser.parse(args[key])
        }
      }
    } catch (error) {
      throw new CallError('arguments', String(error))
    }
  },
})

// Local serialization shares work even if separate hosts install observers on
// the same Graph. Durable starts also prevent another executor from replaying.
const locks = new WeakMap<Graph, Map<Eid, Promise<Bundle[]>>>()
const text = (value: unknown) =>
  typeof value == 'string' ? value : JSON.stringify(value) ?? String(value)

/** Execute one recorded call. Scheduling and authority belong to the host.
 * The returned bundles are committed outcomes. There is no implicit retry.
 */
export const executeCall = (
  graph: Graph,
  id: Eid,
  options: CallOptions,
): Promise<Bundle[]> => {
  let calls = locks.get(graph)
  if (!calls) locks.set(graph, calls = new Map())
  const existing = calls.get(id)
  if (existing) return existing
  const run = async (): Promise<Bundle[]> => {
    const [call] = await graph.storage.tx((tx) => tx.get([id]))
    if (!call?.call) throw new CallError('call', 'Not a call: ' + id)
    const results = await graph.read(and(eq('result.call', id)))
    if (results.length) return results
    if (call.execution) throw new UnfinishedCall(id)
    const c = call.call as Comp
    const invocation = options.resolve(String(c.to), call)
    // A failed precondition is deliberately not retried. Another writer may
    // own this call, including a writer using a separate Graph connection.
    await graph.apply([{
      entity: call.entity,
      execution: { state: 'started' },
      $was: {
        execution: { state: null },
        call: { to: token(c.to), args: token(c.args) },
      },
    }], { trusted: true })
    const mint = options.mint ?? (() => crypto.randomUUID())
    const added: Bundle[] = []
    const started = performance.now()
    let output: string
    try {
      if (!invocation) throw new CallError('tool', 'no such tool: ' + c.to)
      let args: unknown
      try {
        args = JSON.parse(String(c.args ?? '{}'))
      } catch {
        throw new CallError('arguments', 'Invalid JSON tool arguments')
      }
      if (!args || typeof args != 'object' || Array.isArray(args)) {
        throw new CallError('arguments', 'Tool arguments must be an object')
      }
      try {
        args = validateToolInput(invocation, args as Record<string, unknown>)
      } catch (error) {
        throw new CallError('arguments', String(error))
      }
      invocation.validate?.(args as Record<string, unknown>)
      output = (invocation.format ?? text)(
        await invocation.run(args as Record<string, unknown>),
      )
    } catch (error) {
      if (!(error instanceof CallError)) options.report?.(error, call)
      output = 'tool failed: ' + String(error)
      added.push({
        entity: { eid: mint() },
        content: { body: String(error), source: id },
        ...error instanceof CallError
          ? { error: { code: error.code } }
          : { exception: {} },
      })
    }
    added.push({
      entity: { eid: mint() },
      result: { call: id, ms: Math.round(performance.now() - started) },
      content: { body: output },
    }, {
      entity: call.entity,
      execution: { state: 'completed' },
      $was: { execution: { state: token('started') } },
    })
    // Storage failure intentionally leaves the durable started record. Running
    // the tool again could repeat an external action that already succeeded.
    return await graph.apply(added, { trusted: true })
  }
  const pending = run().finally(() => calls!.delete(id))
  calls.set(id, pending)
  return pending
}
