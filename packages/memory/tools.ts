// What anybody may ask of a memory: the `@yaks/memory/tools` entry point — the
// implementations behind the two `tool: true` declarations in ./vocab.json.
// Two tools, and together they are one loop: keep what somebody said, and get
// it back the next time it matters.
//
// The loop is why the read returns A token. A memory is edited by replacing the
// words in it, and words replaced by somebody who never read the ones already
// there is a lost update — the one failure a fleet of agents writing to one
// graph produces on its own. So a recall returns each memory with a `$was`
// field, the graph's own way of recording "this is what it held when I read it"
// (@yaks/graph ./guard.ts), and a save that replaces words must pass that token
// back. A caller that read is a caller that may write; one that did not is
// rejected before it costs anybody the sentence.
//
// Nothing here ranks. `line()` (./recall.ts) builds the query string, and the
// store answers it: its full-text index over `doc` selects the memories
// containing the words — all of them, which is what somebody searching means —
// and its vectors order those results where a `near` was named and the server
// composed @yaks/embedding. A server with neither returns the newest of what
// the words selected, which is a worse answer and not a broken one.

import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  token,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { MEMORY } from './comp.ts'
import { FEEDBACK, saved } from './save.ts'
import { type Asked, line } from './recall.ts'

/** How many memories a recall returns when the caller gave no limit. */
export let LIMIT = 8

/** Why a save that would overwrite unread words is rejected: how to get the
 * token it is missing, and why that token is not in this message. */
export let unread = (id: string): string =>
  `saving over ${id} replaces the words it holds, so it needs the words you ` +
  `started from. Recall it, merge your change into what it holds, and pass ` +
  `the was: token that came back with it. The token is not in this message ` +
  `on purpose: words you have not read are words you would overwrite.`

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : []

// Who gave a correction, as the eid they are: `feedback` takes a name or an
// id and may be empty, so it is not a declared reference the runner resolves
// the way it resolves `id`, `scope` and `near` (@yaks/tools).
let byWhom = async (graph: Graph, said: string): Promise<string> =>
  said ? (await addressed(graph, [said]))[0] : ''

// A memory as it stands right now, for a patch to be judged against: the
// entity the caller named, or nothing where it names no memory of this graph.
let held = async (graph: Graph, eid: string): Promise<Bundle | undefined> =>
  (await graph.read(`.eid=${eid}&.${MEMORY}&?doc`))[0]

/** One memory as it is returned: whole, carrying the token a save will ask
 * for. Absent words read back as `null`, which is how the precondition check
 * records "it held none". */
export let witnessed = (b: Bundle): Bundle => ({
  ...b,
  $was: { doc: { body: token(comp(b, 'doc').body ?? null) } },
})

/** The implementations of the tools ./vocab.json declares. A factory, like
 * every other entry point in these packages, though this one needs nothing
 * from the server: everything a handler reads arrives on the call it is
 * handed. */
export let runs = (): Runs => ({
  memory_save: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let named = str(args.id)
    let scope = str(args.scope)
    let feedback = args.feedback
    let by = await byWhom(graph, str(feedback))
    if (!named) {
      return saved({
        eid: '$memory',
        said: str(args.said),
        title: str(args.title),
        context: str(args.context),
        ...(scope ? { scope } : {}),
        about: str(args.about),
        ...(feedback == null ? {} : { feedback: by || true }),
      })
    }
    let was = await held(graph, named)
    if (!was) throw new Error(`no memory: ${named}`)
    // The words, and the one precondition that matters. A patch that leaves
    // them alone needs no token; one that replaces words the memory actually
    // holds must pass the token for the words it held.
    let doc: Comp = {}
    if (args.title != null) doc.title = str(args.title)
    if (args.said != null) doc.body = str(args.said)
    let words = comp(was, 'doc').body
    let said = args.said != null
    if (said && words != null && !args.was) throw new Error(unread(named))
    let memory: Comp = {}
    if (scope) memory.scope = scope
    if (args.context != null) memory.context = str(args.context)
    if (args.about != null) memory.about = str(args.about)
    return [{
      entity: { eid: named },
      ...(Object.keys(doc).length ? { doc } : {}),
      ...(Object.keys(memory).length ? { [MEMORY]: memory } : {}),
      ...(feedback == null ? {} : { [FEEDBACK]: by ? { by } : {} }),
      ...(said ? { $was: { doc: { body: str(args.was) || null } } } : {}),
    }]
  },

  memory_recall: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let named = ids(args.ids)
    let near = str(args.near)
    let scope = str(args.scope)
    let asked: Asked = {
      limit: Number(args.limit ?? LIMIT),
      said: str(args.said),
      ...(near ? { near } : {}),
      ...(scope ? { scope } : {}),
      ...(args.feedback ? { feedback: true } : {}),
      ...(named.length ? { eids: await addressed(graph, named) } : {}),
    }
    return (await graph.read(line(asked))).map(witnessed)
  },
})
