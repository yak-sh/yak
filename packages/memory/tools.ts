// What anybody may ask of a memory: the `tools` facet a host takes
// (`@yaks/memory/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json. Two words, and they are one loop: keep what somebody said, and
// have it back the next time it matters.
//
// THE LOOP IS WHY THE TOKEN RIDES THE READ. A memory is edited by replacing
// the words in it, and words replaced by somebody who never read the ones
// there is the lost update — the one failure a fleet of agents writing to one
// graph produces on its own. So a recall hands each memory back wearing
// `$was`, the graph's own spelling for "this is what it held when I read it"
// (@yaks/graph ./guard.ts), and a save that replaces words asks for that token
// back. A caller that read is a caller that can write; one that did not is
// refused before it costs anybody the sentence.
//
// NOTHING HERE RANKS. `line()` (./recall.ts) says what to ask the store for,
// and the store answers it: its full-text index over `doc` selects the
// memories saying the words — every one of them, which is what somebody
// searching means — and its vectors put them in order where a `near` was named
// and the host composed @yaks/embedding. A host with neither answers the
// newest of what the words selected, which is a worse answer and not a broken
// one.

import {
  addressed,
  type Bundle,
  type Comp,
  token,
  type ToolCtx,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { MEMORY } from './comp.ts'
import { FEEDBACK, saved } from './save.ts'
import { type Asked, line } from './recall.ts'

/** How many memories a recall answers when nobody said. */
export let LIMIT = 8

/** What a save that would clobber is refused with: the way to get the token
 * it is missing, and why it is not in this sentence. */
export let unread = (id: string): string =>
  `saving over ${id} replaces the words it holds, so it needs the words you ` +
  `started from. Recall it, merge your change into what it says, and pass ` +
  `the was: token that came back with it. The token is not in this message ` +
  `on purpose: words you have not read are words you would overwrite.`

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : []

// The arguments that name an entity, as eids. A person types `P-19`, never an
// eid, and one call resolves every id the line carried.
let at = async (
  ctx: ToolCtx,
  said: Record<string, string>,
): Promise<Record<string, string>> => {
  let keys = Object.keys(said).filter((k) => said[k])
  let found = await addressed(ctx.graph, keys.map((k) => said[k]))
  return Object.fromEntries(keys.map((k, i) => [k, found[i]]))
}

// A memory as it stands right now, for a patch to be judged against: the
// entity the caller named, or nothing where it names no memory of this graph.
let held = async (ctx: ToolCtx, eid: string): Promise<Bundle | undefined> =>
  (await ctx.read(`.eid=${eid}&.${MEMORY}&.doc?`))[0]

/** One memory as it is handed back: whole, wearing the token a save will ask
 * for. Absent words read back as `null`, which is what the guard means by "it
 * held none". */
export let witnessed = (b: Bundle): Bundle => ({
  ...b,
  $was: { doc: { body: token(comp(b, 'doc').body ?? null) } },
})

/** The runs behind the tools ./vocab.json declares. A factory, as every facet
 * is, though this one needs nothing from the host: what a run reads arrives on
 * the call's own context. */
export let runs = (): Runs => ({
  memory_save: async (_bundles, ctx): Promise<Bundle[]> => {
    let named = str(ctx.args.id)
    let feedback = ctx.args.feedback
    let eids = await at(ctx, {
      id: named,
      scope: str(ctx.args.scope),
      by: str(feedback),
    })
    if (!named) {
      return saved({
        eid: '$memory',
        said: str(ctx.args.said),
        title: str(ctx.args.title),
        context: str(ctx.args.context),
        ...(eids.scope ? { scope: eids.scope } : {}),
        about: str(ctx.args.about),
        ...(feedback == null ? {} : { feedback: eids.by || true }),
      })
    }
    let was = await held(ctx, eids.id)
    if (!was) throw new Error(`no memory: ${named}`)
    // The words, and the one guard that matters. A patch that leaves them
    // alone needs no token; one that replaces words the memory actually holds
    // needs the ones it held.
    let doc: Comp = {}
    if (ctx.args.title != null) doc.title = str(ctx.args.title)
    if (ctx.args.said != null) doc.body = str(ctx.args.said)
    let words = comp(was, 'doc').body
    let said = ctx.args.said != null
    if (said && words != null && !ctx.args.was) throw new Error(unread(named))
    let memory: Comp = {}
    if (eids.scope) memory.scope = eids.scope
    if (ctx.args.context != null) memory.context = str(ctx.args.context)
    if (ctx.args.about != null) memory.about = str(ctx.args.about)
    return [{
      entity: { eid: eids.id },
      ...(Object.keys(doc).length ? { doc } : {}),
      ...(Object.keys(memory).length ? { [MEMORY]: memory } : {}),
      ...(feedback == null
        ? {}
        : { [FEEDBACK]: eids.by ? { by: eids.by } : {} }),
      ...(said ? { $was: { doc: { body: str(ctx.args.was) || null } } } : {}),
    }]
  },

  memory_recall: async (_bundles, ctx): Promise<Bundle[]> => {
    let named = ids(ctx.args.ids)
    let eids = await at(ctx, {
      near: str(ctx.args.near),
      scope: str(ctx.args.scope),
    })
    let asked: Asked = {
      limit: Number(ctx.args.limit ?? LIMIT),
      said: str(ctx.args.said),
      ...(eids.near ? { near: eids.near } : {}),
      ...(eids.scope ? { scope: eids.scope } : {}),
      ...(ctx.args.feedback ? { feedback: true } : {}),
      ...(named.length ? { eids: await addressed(ctx.graph, named) } : {}),
    }
    return (await ctx.read(line(asked))).map(witnessed)
  },
})
