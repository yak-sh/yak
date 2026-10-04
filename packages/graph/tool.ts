/** How a tool is named, independently of any transport, what a tool reads off
 * the call it is handed, plus the id resolution every tool that takes an id
 * needs. */
import type { Actor, Bundle, Comp, Eid } from './bundle.ts'
import type { Surface, Tool } from './plugin.ts'
import { alive } from './bundle.ts'
import { minted } from './mint.ts'
import { Refused } from './admit.ts'
import type { ReadTx } from './storage.ts'
import type { Vocab } from '@yaks/vocab'
import { after, each } from '@yaks/fp'
import { and, eq, present, want } from '@yaks/query'

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
 * reads `via`. A call not yet stamped says it on `$actor`, as the batch that
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

/** Resolve registered addresses for callers that supply their own fallback. */
export let addressed = async (
  graph: {
    address: (
      ids: string[],
      kind?: string,
    ) => Map<string, Eid> | Promise<Map<string, Eid>>
  },
  ids: string[],
  kind?: string,
): Promise<Eid[]> => {
  let at = await graph.address(ids, kind)
  return ids.map((id) => at.get(id) ?? id)
}

/**
 * Resolve a reference through registered addresses, then an exact title of
 * the requested kind. Only a live word eid takes precedence over a name;
 * minted ids retain identity even when absent or deleted.
 */
export let referenced = (
  graph: Pick<ReadTx, 'get' | 'read'> & {
    vocab: Vocab
    address: (
      ids: string[],
      kind?: string,
    ) => Map<string, Eid> | Promise<Map<string, Eid>>
  },
  ids: string[],
  kind = 'entity',
): Eid[] | Promise<Eid[]> =>
  after(graph.address(ids, kind), (at) => {
    let eids = ids.map((id) => at.get(id) ?? id)
    let words = eids.filter((id) => !!id && !id.startsWith('$') && !minted(id))
    if (!words.length) return eids
    return after(graph.get(words), (rows) => {
      let held = new Map(rows.map((b) => [b.entity.eid, b]))
      return each(
        ids.map((said, i) => ({ said, i })),
        eids,
        (out, { said, i }) => {
          if (!words.includes(eids[i]) || alive(held.get(eids[i]))) return out
          let matches = graph.vocab.prop('doc', 'title')
            ? graph.read(and(
              eq('doc.title', said),
              ...kind == 'entity' ? [] : [present(kind)],
              want('entity'),
            ))
            : []
          return after(matches, (found) => {
            if (found.length > 1) {
              throw new Refused(
                `${said} names several ${kind} candidates: ` +
                  found.map((b) => b.entity.eid).join(', ') + '; use an id',
              )
            }
            if (!found.length) {
              throw new Refused(
                `${said} names ${kind == 'entity' ? 'nothing' : `no ${kind}`}`,
              )
            }
            out[i] = found[0].entity.eid
            return out
          })
        },
      )
    })
  })

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

/** Is a tool offered on this surface? A tool that names no surfaces is
 * offered on every one.
 *
 * ```ts
 * import { offered } from '@yaks/graph'
 *
 * offered('mcp')({ surfaces: ['cli'] }) // false
 * offered('mcp')({}) // true
 * ```
 */
export let offered =
  (surface: Surface) => (tool: { surfaces?: readonly Surface[] }): boolean =>
    !tool.surfaces || tool.surfaces.includes(surface)

export const namedTool = <R>(tool: Tool<R>): NamedTool<R> => ({
  ...tool,
  name: toolName(tool),
})
