/** How a tool is named, independently of any transport, what a tool reads off
 * the call it is handed, plus the id resolution every tool that takes an id
 * needs. */
import type { Actor, Bundle, Comp, Eid } from './bundle.ts'
import type { Tool } from './plugin.ts'
import { type NamedTool, toolName } from './tool_meta.ts'
export { type NamedTool, offered, type ToolId, toolName } from './tool_meta.ts'
import { alive } from './bundle.ts'
import { minted } from './mint.ts'
import { Refused } from './errors.ts'
import type { ReadTx } from './storage.ts'
import type { Vocab } from '@yaks/vocab'
import { after, each, same } from '@yaks/fp'
import { merged } from './gather.ts'
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

/** Who decided the request: `call.actor` after an executable edit, otherwise
 * `created{by, via}` — the identity it acts for and the run it came through —
 * or `null` for nobody. A tool writes in
 * that name, never the runner's; one that needs the session behind a call
 * reads `via`. A call not yet stamped says it on `$actor`, as the batch that
 * writes it does. */
export let who = (call: Bundle): Actor | null => {
  let actor = part(call, 'call')?.actor as Actor | undefined
  let said = (prop: 'by' | 'via') =>
    actor != null
      ? actor[prop]
      : part(call, 'created')?.[prop] ?? call.$actor?.[prop]
  let by = said('by')
  let via = said('via')
  return by || via
    ? {
      ...(by ? { by: String(by) } : {}),
      ...(via ? { via: String(via) } : {}),
    }
    : null
}

// A semantic edit transfers the whole identity pair. Keeping a missing `via`
// from the original author would let the editor borrow that author's session.
// Comparing the patched request keeps no-op edits and bookkeeping neutral.
// Adding a call to an existing entity is also a new decision: its creation
// stamp may belong to somebody else. A replica copies accepted authority.
export let authoredCall = (
  b: Bundle,
  previous: Bundle | undefined,
  actor: Actor,
  vocab: Vocab,
): Bundle => {
  if (!b.call || !vocab.prop('call', 'actor')?.stamped) return b
  if (!previous?.call && !previous?.created) return b
  let before = part(previous!, 'call')
  let next = part(merged(previous ?? null, b), 'call')!
  if (
    before &&
    ['to', 'args', 'source', 'target'].every((prop) =>
      same(
        before[prop] ?? (prop == 'args' ? {} : null),
        next[prop] ?? (prop == 'args' ? {} : null),
      )
    )
  ) return b
  return { ...b, call: { ...b.call as Comp, actor: { ...actor } } }
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
    if (eids.some((id) => !id)) {
      throw new Refused(
        'an empty reference names nothing; use null to clear it',
      )
    }
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

export const namedTool = <R>(tool: Tool<R>): NamedTool<R> => ({
  ...tool,
  name: toolName(tool),
})
