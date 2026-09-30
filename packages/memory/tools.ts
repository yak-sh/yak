// What anybody may ask of a memory: the `@yaks/memory/tools` entry point — the
// implementations behind the `tool: true` declarations in ./vocab.json. Two of
// them are one loop: keep what somebody said, and get it back the next time it
// matters. A third finds where somebody said words, the place a save marks;
// the rest read around a memory (./around.ts), and two find and make the topics
// beliefs are about (./topic.ts).
//
// Keeping marks. What somebody said is usually in the graph already — what they
// typed is a transcript entry, what they wrote is a comment or a doc — so a
// save marks that entity rather than copying the words into a new one: the
// entity it names with `on`, or, where it says who said them, the earliest
// one that person wrote holding the words verbatim. Only words it cannot place
// become a doc of their own.
//
// The loop is why the read returns A token. A memory made to hold words is
// edited by replacing them, and words replaced by somebody who never read the
// ones already there is a lost update — the one failure a fleet of agents
// writing to one graph produces on its own. So a recall returns each memory
// with a `$was` field, the graph's own way of recording "this is what it held
// when I read it" (@yaks/graph ./guard.ts), and a save that replaces words must
// pass that token back. The words a mark sits on are what happened where they
// were said, and no save replaces them.
//
// Nothing here ranks. `line()` (./recall.ts) builds the query string, and the
// store answers it: its full-text index selects the memories containing the
// words — all of them, which is what somebody searching means — and its vectors
// order those results where a `near` was named and the server composed
// @yaks/embedding. A server with neither returns the newest of what the words
// selected, which is a worse answer and not a broken one.

import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  Refused,
  token,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { MEMORY } from './comp.ts'
import { EMPTY, FEEDBACK, marked, type Marking, saved } from './save.ts'
import { type Asked, line, terms, words } from './recall.ts'
import { around } from './around.ts'
import { topics } from './topic.ts'

/** How many memories a recall returns when the caller gave no limit. */
export let LIMIT = 8

// How many entities holding the words a save looks through for the one to
// mark: the earliest few, since the first place words were said comes before
// every place they were quoted.
let LOOK = 20

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

// Words compared as written, but for how they were wrapped: a line break an
// importer or an agent put in is not a different sentence.
let flat = (s: string) => s.replace(/\s+/g, ' ').trim()

// Who gave a correction, as the eid they are: `feedback` takes a name or an
// id and may be empty, so it is not a declared reference the runner resolves
// the way it resolves `id`, `scope`, `on` and `near` (@yaks/tools).
let byWhom = async (graph: Graph, said: string): Promise<string> =>
  said ? (await addressed(graph, [said]))[0] : ''

// A memory as it stands right now, for a patch to be judged against: the
// entity the caller named, or nothing where it names no memory of this graph.
let held = async (graph: Graph, eid: string): Promise<Bundle | undefined> =>
  (await graph.read(`.eid=${eid}&.${MEMORY}&*`))[0]

// Where the graph already holds what `by` said: the earliest entity they
// wrote whose text holds the words verbatim. Only the speaker's own: the same
// words in anybody else's text are a quote of them, and a doc edited to quote
// them can be older than the words themselves. The store's full-text index
// finds the entities holding the phrase, and the words are then compared as
// written.
let holding = async (
  graph: Pick<Graph, 'read'>,
  said: string,
  by: string,
): Promise<Bundle | undefined> => {
  let phrase = terms(said)
  if (!phrase) return undefined
  let found = await graph.read(
    `"${phrase}"&.created.by=${by}&*&.order=created.at&.limit=${LOOK}`,
  )
  let want = flat(said)
  return found.find((b) => flat(words(b)).includes(want))
}

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
    let where: Omit<Marking, 'eid'> = {
      ...(scope ? { scope } : {}),
      context: str(args.context),
      about: str(args.about),
      ...(feedback == null ? {} : { feedback: by || true }),
    }
    if (!named) {
      let said = str(args.said).trim()
      let on = str(args.on)
      let at = on
        ? (await graph.get([on]))[0]
        : said && by
        ? await holding(graph, said, by)
        : undefined
      if (on && !at) throw new Refused(`nothing is ${on}`)
      if (on && !words(at!)) throw new Refused(`${on} holds no words`)
      if (on && said && !flat(words(at!)).includes(flat(said))) {
        throw new Refused(`${on} does not hold those words: ${said}`)
      }
      if (at) return marked({ eid: at.entity.eid, ...where })
      if (!said) throw new Refused(EMPTY)
      return saved({ eid: '$memory', said, title: str(args.title), ...where })
    }
    let was = await held(graph, named)
    if (!was) throw new Refused(`no memory: ${named}`)
    // The words, and the one precondition that matters. A patch that leaves
    // them alone needs no token; one that replaces words the memory actually
    // holds must pass the token for the words it held. Words a memory marks on
    // something more than itself — a comment, an entry, a task — are what
    // happened there, and are never replaced.
    let doc: Comp = {}
    if (args.title != null) doc.title = str(args.title)
    if (args.said != null) doc.body = str(args.said)
    let said = args.said != null
    if (said && graph.vocab.kindOf(was) != MEMORY) {
      throw new Refused(
        `${named} is a mark on what was said there, and a memory never ` +
          'replaces those words',
      )
    }
    if (said && comp(was, 'doc').body != null && !args.was) {
      throw new Refused(unread(named))
    }
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

  memory_source: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let said = str(args.said)
    let by = str(args.by)
    let found = await holding(graph, said, by)
    if (!found) {
      throw new Refused(`nothing ${by} wrote holds those words: ${said}`)
    }
    return [found]
  },

  ...around,
  ...topics(),
})
