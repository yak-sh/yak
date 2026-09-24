/** How a tool is named, independently of any transport, what a tool reads off
 * the call it is handed, plus the id resolution every tool that takes an id
 * needs. */
import type { Actor, Bundle, Comp, Eid } from './bundle.ts'
import type { Tool } from './plugin.ts'

let part = (call: Bundle, comp: string): Comp | undefined =>
  call[comp] as Comp | undefined

/** A call's arguments: `call.args`, the object the tool's schema describes,
 * already checked by the runner that handed the call over — or none at all.
 *
 * ```ts
 * import { argsOf } from '@yaks/graph'
 *
 * argsOf({ entity: { eid: 'c' }, call: { args: { id: 'T-1' } } }).id // 'T-1'
 * ```
 */
export let argsOf = (call: Bundle): Record<string, unknown> =>
  (part(call, 'call')?.args ?? {}) as Record<string, unknown>

/** Who asked: the `created{by, via}` a call carries — the identity it acts
 * for, and the run it came through — or `null` for nobody. A tool writes in
 * that name, never the runner's; one that needs the session behind a call
 * reads `via`. A call not yet stamped says it on `$actor`, as the change that
 * writes it does. */
export let who = (call: Bundle): Actor | null => {
  let said = (prop: 'by' | 'via') =>
    part(call, 'created')?.[prop] ?? call.$actor?.[prop]
  let by = said('by')
  let via = said('via')
  return by || via
    ? {
      ...(by ? { by: String(by) } : {}),
      ...(via ? { via: String(via) } : {}),
    }
    : null
}

/**
 * The ids a caller passed, resolved to the eids they refer to — through
 * whatever a plugin resolves (a name, a human-readable id), and left as they
 * are when no plugin resolves them, since an eid needs no resolution.
 *
 * Every tool that takes an id owes its caller this: an argument is what a
 * person types, not what the store happens to key rows by.
 */
export let addressed = async (
  graph: {
    address: (ids: string[]) => Map<string, Eid> | Promise<Map<string, Eid>>
  },
  ids: string[],
): Promise<Eid[]> => {
  let at = await graph.address(ids)
  return ids.map((id) => at.get(id) ?? id)
}

/** The three fields that decide what a tool is called — all `toolName` reads,
 * so it can be called on a command whose `run` and result types belong to
 * another package. */
export type ToolId = { name?: string; noun?: string; verb?: string }

export type NamedTool<R = Bundle[]> = Tool<R> & {
  name: string
}

/** The name a tool is listed and called under: its own `name` where it has
 * one, otherwise derived from what it declared — `noun_verb` for a pair, and
 * the single word for a tool that declared only a noun or only a verb, where
 * the command and the tool name are the same word. */
export const toolName = (tool: ToolId): string => {
  const said = [tool.noun, tool.verb].filter((w) => w != null)
  if (said.length) {
    const word = /^[a-z][a-z0-9-]*$/
    if (!said.every((w) => word.test(w))) {
      throw new Error('A tool noun and verb are single lowercase words')
    }
    return tool.name ?? said.join('_')
  }
  if (!tool.name) throw new Error('Tool needs a noun, a verb, or a legacy name')
  return tool.name
}

export const namedTool = <R>(tool: Tool<R>): NamedTool<R> => ({
  ...tool,
  name: toolName(tool),
})
