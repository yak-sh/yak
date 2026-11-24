// The persona a transcript wears and the topic it is opened on, said afresh
// for each ask (agent.ts `wear`): read through @yaks/persona and @yaks/topic
// alone, so a host that runs no machine (the yaks.app Worker) loads nothing
// of the instruction files beside it.
import type { Bundle, Comp, Eid, Graph, NamedTool } from '@yaks/graph'
import { argsOf, who } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { human, short } from '@yaks/id'
import { type Built, line } from '@yaks/query'
import {
  beside,
  fold,
  offer,
  PART,
  type Reads,
  voice,
  wear,
  wearing,
  wearLayers,
} from '@yaks/persona'
import { compile, gather } from '@yaks/topic'

// How far up its starters what a transcript is opened as is looked for: a
// fork of a helper of a conversation is three.
let STARTERS = 16

/** What a transcript is opened as: the persona it wears and the topic it is
 * opened on, with the project it is filed under and the directory it works
 * in where this graph keeps those. */
export type Opened = {
  persona?: Eid
  topic?: Eid
  project?: Eid
  cwd?: string
}

/** What a transcript is opened as: its own `session{persona, topic}`, else
 * those of the session that started it, since a fork or a helper works as the
 * one that started it does. */
export let openedAs = async (g: Graph, session: Eid): Promise<Opened> => {
  // Only what this graph declares: one made without personas, topics or
  // projects opens its transcripts as nothing.
  let fields = [
    ['session', 'persona'],
    ['session', 'topic'],
    ['spawned', 'parent'],
    ['filed', 'project'],
    ['home', 'cwd'],
  ].filter(([comp, prop]) => g.vocab.prop(comp, prop)).map((f) => f.join('.'))
  if (!fields.length) return {}
  let asked = (id: Eid): Built => line`.entity.eid=${id}&.fields=${fields}`
  let at: Eid | undefined = session
  for (let i = 0; at && i < STARTERS; i++) {
    let [row]: Bundle[] = await g.read(asked(at))
    let s = row?.session as Comp | undefined
    if (s?.persona || s?.topic) {
      let project = (row.filed as Comp | undefined)?.project
      let cwd = (row.home as Comp | undefined)?.cwd
      return {
        ...s.persona ? { persona: String(s.persona) } : {},
        ...s.topic ? { topic: String(s.topic) } : {},
        ...project ? { project: String(project) } : {},
        ...cwd ? { cwd: String(cwd) } : {},
      }
    }
    let parent: unknown = (row?.spawned as Comp | undefined)?.parent
    at = parent ? String(parent) : undefined
  }
  return {}
}

/** The persona a transcript wears ({@link openedAs}). */
export let personaOf = async (
  g: Graph,
  session: Eid,
): Promise<Eid | undefined> => (await openedAs(g, session)).persona

/** How a transcript's persona is worn: where its bases (`persona.base`) are
 * kept when this graph does not keep them, whether the tree of the topic it
 * is opened on follows the persona's text, and whether the tools the persona
 * contains are all the transcript is offered. */
export type Wear = { bases?: Reads; topic?: boolean; tools?: boolean }

// The persona as its session opened wearing it (@yaks/persona `wearing`): one
// that is the common persona of the session's work or checkout is heard with
// each common persona above it, and any other on its base.
let worn = async (g: Graph, as: Opened, bases?: Reads) => {
  if (!as.persona) return
  let common = as.project || as.cwd
    ? await wearing(g, as.cwd ?? '', { work: as.project })
    : undefined
  return common?.persona.entity.eid == as.persona
    ? common
    : await wear(g.storage, g.vocab, bases)(as.persona)
}

/** What a transcript wears, as text: its persona ({@link openedAs}), its
 * bases read from `how.bases` (@yaks/persona `wear`), and where `how.topic`
 * asks, the tree of the topic it is opened on after it (@yaks/topic
 * `compile`). Undefined where it wears no persona and is opened on no topic.
 * Read on each call, so an edit to the persona, a base or the topic reaches a
 * transcript on its next ask. */
export let wornBy = async (
  g: Graph,
  session: Eid,
  how: Wear = {},
): Promise<string | undefined> => {
  let as = await openedAs(g, session)
  let [persona, topic] = await Promise.all([
    worn(g, as, how.bases),
    how.topic && as.topic ? gather(g)(as.topic) : undefined,
  ])
  return [
    persona && voice(g.vocab)(persona).trimEnd(),
    topic && compile(g.vocab)(topic),
  ].filter(Boolean).join(PART) || undefined
}

/** The shared base and what this session wears over it, in prompt order.
 * Only the configured base can start the shared prefix. */
export let wornLayers = async (
  g: Graph,
  session: Eid,
  how: Wear,
  shared: Eid,
): Promise<{ shared?: string; local?: string }> => {
  let { persona } = await openedAs(g, session)
  if (!persona) return {}
  let layers = await wearLayers(g.storage, g.vocab, how.bases)(persona)
  let render = voice(g.vocab)
  let [head, ...tail] = layers
  if (!head) return {}
  if (head.persona.entity.eid != shared) {
    return { local: render(fold(head, ...tail)).trimEnd() }
  }
  let [own, ...more] = tail
  return {
    shared: render(head).trimEnd(),
    local: own ? render(beside(fold(own, ...more), head)).trimEnd() : undefined,
  }
}

/** The names of the tools a transcript is offered by the persona it wears
 * ({@link openedAs}, @yaks/persona `offer`): the registered tools it contains,
 * itself or through a persona it includes or is said with. Undefined where it
 * wears none or its persona contains none, which leaves the runner's own set.
 * Read on each call, so a tool the persona gains reaches a transcript on its
 * next ask. */
export let offeredTo = async (
  g: Graph,
  session: Eid,
  how: Wear = {},
): Promise<string[] | undefined> =>
  offer(await worn(g, await openedAs(g, session), how.bases))

// What a Read is called by: its id as the persona's text draws it, its short
// handle, its eid, or its title.
let callsOf = (g: Graph, b: Bundle): string[] =>
  [
    human(g.vocab)(b),
    short(b.entity.eid),
    b.entity.eid,
    String((b.doc as Comp | undefined)?.title ?? ''),
  ].map((s) => s.trim().toLowerCase()).filter(Boolean)

/** The Reads a transcript's persona names ({@link openedAs}): the documents
 * it, or a base under it, links by `reads`, each read where it is kept. */
export let readsOf = async (
  g: Graph,
  session: Eid,
  how: Wear = {},
): Promise<Bundle[]> =>
  (await worn(g, await openedAs(g, session), how.bases))?.names ?? []

/** The Read among `names` that `asked` names: by its id or title, or,
 * `loosely`, by its id and more words or the start of its title. */
export let readAt = (
  g: Graph,
  names: Bundle[],
  asked: string,
  loosely = true,
): Bundle | undefined => {
  let said = asked.trim().toLowerCase()
  let title = (b: Bundle) => callsOf(g, b).at(-1) ?? ''
  return names.find((b) => callsOf(g, b).includes(said)) ??
    (loosely
      ? names.find((b) =>
        callsOf(g, b).some((c) => said.startsWith(c + ' '))
      ) ??
        names.find((b) => said.length > 3 && title(b).startsWith(said))
      : undefined)
}

/** A Read as one text: its id and title as a heading, then its body. */
export let readText = (g: Graph, b: Bundle): string => {
  let doc = (b.doc ?? b.content ?? {}) as Comp
  return `# ${human(g.vocab)(b)} ${doc.title ?? ''}`.trim() + '\n\n' +
    String(doc.body ?? '')
}

/**
 * The tool that opens one of the Reads a transcript's persona names (its
 * `reads` documents, @yaks/persona `voice`'s `## Reads`) in full, by the id
 * the text gives it or its title, read where it is kept: the transcript's own
 * graph or `how.bases`. Only the persona's Reads open, so it reaches nothing
 * else of where the bases are kept.
 */
export let readOpen = (how: Wear = {}): NamedTool => ({
  name: 'read_open',
  title: 'Read instructions',
  step: {
    doing: 'Reading the instructions for this…',
    done: 'Read the instructions for this',
  },
  description:
    'Open one of the Reads your instructions list under "## Reads", in full, ' +
    'by its id there (or its title). Open one before work it covers.',
  inputSchema: {
    type: 'object',
    properties: {
      read: { type: 'string', description: 'its id from the Reads list' },
    },
    required: ['read'],
    additionalProperties: false,
  },
  readOnly: true,
  run: async (call, g) => {
    let session = who(call)?.via
    if (!session) throw new Refused('read_open needs a session')
    let asked = String(argsOf(call).read ?? '').trim()
    let names = await readsOf(g, session, how)
    let found = readAt(g, names, asked)
    if (!found) {
      throw new Refused(
        `no Read called ${asked.toLowerCase() || '(nothing)'}; your Reads are ${
          names.map((b) => human(g.vocab)(b)).join(', ') || 'none'
        }`,
      )
    }
    return [{
      entity: { eid: '$read' },
      content: { body: readText(g, found) },
      output: { source: call.entity.eid },
    }]
  },
})
