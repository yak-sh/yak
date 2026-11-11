// The persona a transcript wears and the topic it is opened on, said afresh
// for each ask (agent.ts `wear`): read through @yaks/persona and @yaks/topic
// alone, so a host that runs no machine (the yaks.app Worker) loads nothing
// of the instruction files beside it.
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { offer, PART, type Reads, voice, wear, wearing } from '@yaks/persona'
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
  let at: Eid | undefined = session
  for (let i = 0; at && i < STARTERS; i++) {
    let [row]: Bundle[] = await g.read(
      `.entity.eid=${at}&.fields=${fields}`,
    )
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
    let parent = (row?.spawned as Comp | undefined)?.parent
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
