// What a session opened on a topic is given: the topic tree compiled from that
// topic, the way a persona is compiled from what it contains (@yaks/persona's
// `wear` and `voice`). {@link gather} reads it out of the graph and
// {@link compile} writes it as one markdown document, a pure function of what
// was read.
//
// In order: where the topic sits (the topics that contain it, up to the roots,
// each by its cover), the topic itself (its cover, its contents, and the
// `$was` token of the contents, so a session rewrites them without reading
// them again), everything it holds in full, the topics below it as an outline,
// and what to understand first, what is related and its sources, a line each.
//
// What it holds is said in full and what lies below is only named, as a
// persona includes what it contains and names what it reads: a root topic's
// session would otherwise carry the whole graph. A body too long to carry is
// cut at a paragraph and says how to read the rest, and what is past the
// budget is listed by id. What does not fit is listed, never dropped.
//
// The ids are the human ones (Q-12, M-3) a session passes back to graph_show;
// every title goes through @yaks/text's `safe`, and a body does not, since
// `safe` would strip the line breaks that make it a document.

import type { Bundle, Eid, Graph } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { human } from '@yaks/id'
import { safe } from '@yaks/text'
import type { Vocab } from '@yaks/vocab'
import { cover, HOLDS, title, TOPIC } from './topic.ts'

/** How many characters of one held entity's body are carried; the rest is
 * named, to be read with graph_show. */
export let CUT = 4000

/** How many characters of held bodies a topic carries in all; past it, what
 * it holds is listed by id and title. */
export let BUDGET = 100000

/** How many levels below the topic its outline goes. */
export let LEVELS = 4

/** How many lines the outline below a topic holds at most. */
export let LINES = 400

/** How many characters of its first line name an entity that has no title. */
export let GIST = 80

// How many edges are read from one topic, or from one level of the tree.
let EDGES = 500

// How far up the topics containing it are followed: deeper means a cycle,
// which `seen` already stops.
let DEPTH = 16

/** A topic below the one compiled: what it holds, by title, and the topics
 * below it in turn. */
export type Branch = { topic: Bundle; holds: Bundle[]; below: Branch[] }

/** One topic's tree, as read. */
export type Gathered = {
  /** the topic */
  topic: Bundle
  /** the topics containing it, up to the roots, root first */
  path: Bundle[]
  /** what it contains that is not a topic, in edge order */
  holds: Bundle[]
  /** the topics it contains, each with what lies below it */
  below: Branch[]
  /** what to understand first (`requires`) */
  needs: Bundle[]
  /** what is related (`reads`, `references`) */
  related: Bundle[]
  /** its sources (`cites`) */
  sources: Bundle[]
}

type Comp = Record<string, unknown>
let str = (b: Bundle | undefined, comp: string, prop: string): string => {
  let v = (b?.[comp] as Comp | undefined)?.[prop]
  return typeof v == 'string' ? v : ''
}
let eidOf = (b: Bundle): Eid => b.entity.eid
let end = (b: Bundle, side: 'from' | 'to'): Eid => str(b, 'edge', side)
let unique = (ids: Eid[]): Eid[] => [...new Set(ids.filter(Boolean))]
let byTitle = (a: Bundle, b: Bundle) =>
  title(a).localeCompare(title(b), undefined, { sensitivity: 'base' })

// The live rows of some eids, by eid.
let rows = async (g: Graph, ids: Eid[]): Promise<Map<Eid, Bundle>> =>
  new Map(
    (ids.length ? await g.get(ids) : [])
      .filter((b) => !b.tombstone)
      .map((b) => [eidOf(b), b]),
  )

// The topics containing `eid`, a level at a time, root first.
let above = async (g: Graph, eid: Eid): Promise<Bundle[]> => {
  let seen = new Set([eid])
  let levels: Bundle[][] = []
  let level = [eid]
  for (let i = 0; i < DEPTH && level.length; i++) {
    let edges = await g.read(
      `.${HOLDS}&.edge.to=${level.join(',')}&?edge&.limit=${EDGES}`,
    )
    let ids = unique(edges.map((b) => end(b, 'from')))
      .filter((id) => !seen.has(id))
    let tops = [...(await rows(g, ids)).values()]
      .filter((b) => b[TOPIC]).toSorted(byTitle)
    for (let b of tops) seen.add(eidOf(b))
    levels.push(tops)
    level = tops.map(eidOf)
  }
  return levels.reverse().flat()
}

// The topics below some subtopics, a level at a time: each one's holdings by
// title and the topics it contains, {@link LEVELS} deep and {@link LINES}
// lines long. A topic met twice is drawn once.
let outline = async (
  g: Graph,
  tops: Bundle[],
  seen: Set<Eid>,
): Promise<Branch[]> => {
  let branches: Branch[] = tops.map((topic) => ({
    topic,
    holds: [],
    below: [],
  }))
  for (let b of tops) seen.add(eidOf(b))
  let level = branches
  let lines = branches.length
  for (let depth = 1; depth < LEVELS && level.length; depth++) {
    let at = new Map(level.map((b) => [eidOf(b.topic), b]))
    let edges = await g.read(
      `.${HOLDS}&.edge.from=${[...at.keys()].join(',')}&?edge` +
        `&.order=edge.ord&.limit=${EDGES}`,
    )
    let ends = await rows(g, unique(edges.map((b) => end(b, 'to'))))
    let next: Branch[] = []
    for (let e of edges) {
      let parent = at.get(end(e, 'from'))
      let held = ends.get(end(e, 'to'))
      if (!parent || !held || lines >= LINES) continue
      if (held[TOPIC]) {
        if (seen.has(eidOf(held))) continue
        seen.add(eidOf(held))
        let branch = { topic: held, holds: [], below: [] }
        parent.below.push(branch)
        next.push(branch)
      } else parent.holds.push(held)
      lines++
    }
    level = next
  }
  return branches
}

/**
 * A topic's tree, read out of a graph: where it sits, what it holds, what
 * lies below it, and what it requires, relates to and cites. `undefined` when
 * the eid names no topic, which is the caller's to refuse.
 *
 * ```ts ignore
 * let got = await gather(g)('Q-59416')
 * if (got) console.log(compile(g.vocab)(got))
 * ```
 */
export let gather =
  (g: Graph) => async (eid: Eid): Promise<Gathered | undefined> => {
    let [topic] = await g.get([eid])
    if (!topic?.[TOPIC] || topic.tombstone) return undefined
    let out = await g.read(
      `.edge.from=${eid}&*&.order=edge.ord&.limit=${EDGES}`,
    )
    let ends = await rows(g, unique(out.map((b) => end(b, 'to'))))
    let along = (rels: string[]): Bundle[] =>
      unique(out.filter((b) => rels.some((r) => b[r])).map((b) => end(b, 'to')))
        .flatMap((id) => ends.get(id) ?? [])
    let held = along([HOLDS])
    return {
      topic,
      path: await above(g, eid),
      holds: held.filter((b) => !b[TOPIC]),
      below: await outline(g, held.filter((b) => b[TOPIC]), new Set([eid])),
      needs: along(['requires']),
      related: along(['reads', 'references']),
      sources: along(['cites']),
    }
  }

// A body as a session reads it: a document's own, or else what its content
// says (a transcript entry, a memory's marked words).
let body = (b: Bundle): string =>
  (str(b, 'doc', 'body') || str(b, 'content', 'body')).trim()

/** A body cut to at most `at` characters, at the last paragraph (else line)
 * break past half of it, and how many characters were left off. */
/// cut('one\n\ntwo', 100) -> { text: 'one\n\ntwo', left: 0 }
/// cut('one two\n\nthree four', 12) -> { text: 'one two', left: 12 }
export let cut = (text: string, at: number): { text: string; left: number } => {
  if (text.length <= at) return { text, left: 0 }
  let head = text.slice(0, at)
  let par = head.lastIndexOf('\n\n')
  let line = head.lastIndexOf('\n')
  let stop = par > at / 2 ? par : line > at / 2 ? line : at
  let kept = text.slice(0, stop).trimEnd()
  return { text: kept, left: text.length - kept.length }
}

/**
 * A topic's tree as one markdown document, the context a session opened on it
 * starts from. Takes the loaded vocabulary first, for the ids it names:
 * `compile(vocab)(gathered)`.
 *
 * ```md
 * # Q-1 Data model
 *
 * How data is shaped in the graph.
 *
 * ## Within
 *
 * - Q-2 Architecture: how the system is built
 *
 * ## Contents
 *
 * What is understood about it.
 *
 * $was of its contents: {"content": {"body": "9f86…"}}
 *
 * ---
 *
 * # M-3 Stored state properties are an anti-pattern
 *
 * a held entity's body, in full
 *
 * ---
 *
 * ## Below
 *
 * - Q-4 Identity: ids, names and keys
 *   - M-5 Names in any system must always be changeable
 * ```
 */
export let compile = (vocab: Vocab): (got: Gathered) => string => {
  let id = human(vocab)
  let called = (b: Bundle): string =>
    b[TOPIC] ? title(b) : str(b, 'doc', 'title')
  // Its id and title: a part's heading, whose body follows.
  let headed = (b: Bundle): string => safe(`${id(b)} ${called(b)}`.trim())
  // Its id and title, or the start of what it says where it has no title (his
  // words in a comment or an entry): a line read with nothing under it.
  let named = (b: Bundle): string => {
    let first = body(b).split('\n').find((l) => l.trim())?.trim() ?? ''
    let gist = first.length > GIST
      ? `${first.slice(0, GIST - 1).trimEnd()}…`
      : first
    return safe(`${id(b)} ${called(b) || gist}`.trim())
  }
  // Its id, title and cover's first paragraph: a topic as a list names it.
  let covered = (b: Bundle): string => {
    let said = safe(cover(b).replace(/\s+/g, ' '))
    return said ? `${named(b)}: ${said}` : named(b)
  }
  let list = (heading: string, items: string[]): string[] =>
    items.length ? [`## ${heading}\n\n${items.join('\n')}`] : []
  let tree = (bs: Branch[], indent = ''): string[] =>
    bs.flatMap((b) => [
      `${indent}- ${covered(b.topic)}`,
      ...b.holds.map((h) => `${indent}  - ${named(h)}`),
      ...tree(b.below, indent + '  '),
    ])
  return (got) => {
    let t = got.topic
    let stored = str(t, 'content', 'body')
    let contents = stored.trim()
    let lead = [
      `# ${headed(t)}`,
      str(t, 'doc', 'body').trim(),
      ...list('Within', got.path.map((b) => `- ${covered(b)}`)),
      ...contents
        ? [
          `## Contents\n\n${contents}`,
          `$was of its contents: ${
            JSON.stringify({ content: { body: token(stored) } })
          }`,
        ]
        : ['## Contents\n\nNothing is written here yet.'],
    ].filter(Boolean).join('\n\n')
    let spent = 0
    let carried: string[] = []
    let past: Bundle[] = []
    for (let b of got.holds) {
      let { text, left } = cut(body(b), CUT)
      if (spent + text.length > BUDGET) {
        past.push(b)
        continue
      }
      spent += text.length
      carried.push(
        [
          `# ${headed(b)}`,
          text,
          left ? `… ${left} more characters: graph_show ${id(b)}.` : '',
        ].filter(Boolean).join('\n\n'),
      )
    }
    let tail = [
      ...list('Below', tree(got.below)),
      ...list('Also held', past.map((b) => `- ${named(b)}`)),
      ...list('Understand first', got.needs.map((b) => `- ${covered(b)}`)),
      ...list('Related', got.related.map((b) => `- ${named(b)}`)),
      ...list('Sources', got.sources.map((b) => `- ${named(b)}`)),
    ].join('\n\n')
    return [lead, ...carried, ...tail ? [tail] : []].join('\n\n---\n\n') +
      '\n'
  }
}
