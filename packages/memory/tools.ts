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
// Nothing here ranks. Words are ranked by meaning where the host keeps vectors
// of its text (@yaks/host `meaning`): it names the memories nearest them among
// those the rest of the recall admits, and the store reads those, so a rank
// never decides what a caller may read. Where it keeps none, or it names none
// (a memory saved a moment ago, not embedded yet), `line()` (./recall.ts)
// builds the query string and the store answers it: its full-text index
// selects the memories containing every word, newest first. A `near` is ranked
// by the store's vectors in that query string, and the words then select. An
// index that fails is a worse order, never a failed recall: the host hears of
// it, and the words select.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { guarded, witnessed } from '@yaks/doc'
export { witnessed } from '@yaks/doc'
import type { Runs } from '@yaks/graph/tools'
import type { Host } from '@yaks/host'
import { MEMORY } from './comp.ts'
import { EMPTY, FEEDBACK, marked, type Marking, saved } from './save.ts'
import { type Asked, line, ordered, terms, words } from './recall.ts'
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

// A memory as it stands right now, for a patch to be judged against: the
// entity the caller named, or nothing where it names no memory of this graph.
let held = async (
  graph: Graph,
  eid: string,
  space?: string,
): Promise<Bundle | undefined> =>
  (await graph.read(
    `.entity.eid=${eid}&.${MEMORY}${space ? `.space=${space}` : ''}&*`,
  ))[0]

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
  space?: string,
): Promise<Bundle | undefined> => {
  let phrase = terms(said)
  if (!phrase) return undefined
  let found = await graph.read(
    `"${phrase}"&.created.by=${by}` +
      (space ? `&.${MEMORY}.space=${space}` : '') +
      `&*&.order=created.at&.limit=${LOOK}`,
  )
  let want = flat(said)
  return found.find((b) => flat(words(b)).includes(want))
}

/** What a recall asks of its host: words ranked by meaning, where it keeps
 * vectors, and where to say that ranking failed. */
export type Ranking = Partial<Pick<Host, 'meaning' | 'report'>>

// The memories nearest the words in meaning, among those `asked` admits
// without them, closest first: none where the host keeps no vectors.
let nearest = async (host: Ranking, asked: Asked): Promise<string[]> => {
  if (!host.meaning) return []
  try {
    let within = line({ ...asked, said: '' })
    let hits = await host.meaning(asked.said!, { limit: asked.limit, within })
    return hits.map((h) => h.entity)
  } catch (e) {
    if (!host.report) throw e
    await host.report(e)
    return []
  }
}

/** The implementations of the tools ./vocab.json declares. A factory, like
 * every other entry point in these packages. A host sharing a graph between
 * spaces binds saves and recalls to one space through its options. */
export let runs = (
  host: Ranking = {},
  { space }: { space?: string } = {},
): Runs => ({
  memory_save: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let named = str(args.id)
    let scope = str(args.scope)
    let feedback = args.feedback
    let by = str(feedback)
    let where: Omit<Marking, 'eid'> = {
      ...(space ? { space } : {}),
      ...(scope ? { scope } : {}),
      context: str(args.context),
      about: str(args.about),
      ...(feedback == null ? {} : { feedback: by || true }),
    }
    if (!named) {
      let said = str(args.said).trim()
      let on = str(args.on)
      let at = on
        ? space ? await held(graph, on, space) : (await graph.get([on]))[0]
        : said && by
        ? await holding(graph, said, by, space)
        : undefined
      if (on && !at) {
        throw new Refused(space ? `no memory: ${on}` : `nothing is ${on}`)
      }
      if (on && !words(at!)) throw new Refused(`${on} holds no words`)
      if (on && said && !flat(words(at!)).includes(flat(said))) {
        throw new Refused(`${on} does not hold those words: ${said}`)
      }
      if (at) return marked({ eid: at.entity.eid, ...where })
      if (!said) throw new Refused(EMPTY)
      return saved({ eid: '$memory', said, title: str(args.title), ...where })
    }
    let was = await held(graph, named, space)
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
    return [guarded({
      entity: { eid: named },
      ...(Object.keys(doc).length ? { doc } : {}),
      ...(Object.keys(memory).length ? { [MEMORY]: memory } : {}),
      ...(feedback == null ? {} : { [FEEDBACK]: by ? { by } : {} }),
    }, said ? str(args.was) || null : undefined)]
  },

  memory_recall: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let named = ids(args.ids)
    let near = str(args.near)
    let scope = str(args.scope)
    let asked: Asked = {
      limit: Number(args.limit ?? LIMIT),
      ...(space ? { space } : {}),
      said: str(args.said),
      ...(near ? { near } : {}),
      ...(scope ? { scope } : {}),
      ...(args.feedback ? { feedback: true } : {}),
      ...(named.length ? { eids: named } : {}),
    }
    let ranked = asked.said?.trim() && !near && !named.length
      ? await nearest(host, asked)
      : []
    let read = async (a: Asked) => (await graph.read(line(a))).map(witnessed)
    return ranked.length
      ? ordered(ranked, await read({ ...asked, said: '', eids: ranked }))
      : await read(asked)
  },

  memory_source: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let said = str(args.said)
    let by = str(args.by)
    let found = await holding(graph, said, by, space)
    if (!found) {
      throw new Refused(`nothing ${by} wrote holds those words: ${said}`)
    }
    return [found]
  },

  ...around,
  ...topics(),
})
