// Topics: the subjects beliefs are about that nothing else in the graph already
// is. A point somebody made about testing is about testing, and no project,
// package, component or design is testing, so a topic stands for it.
//
// The one danger is synonyms. A model names a subject by what it means, not by
// its letters, so left alone it calls the same subject "testing" in one build,
// "tests" in the next and "test suite" in a third, and the beliefs about it
// scatter across three topics that each hold a third of what was said (M-12915
// on why). Three things stand against that. A topic's name is its identity
// (`topic.name` derives its id), folded to lowercase with single spaces, so a
// name said twice is one topic whoever says it, even two builds at once; a
// builder is shown the topics that exist, nearest its words by meaning, before
// it makes one, so it reuses a subject already named; and `topic_new` refuses
// a name that is taken, or whose words hold another topic's or are held by
// them ("economic market design" beside "market design"), and says which
// topic to use. The last is checked when the topic is written, so two builds
// that looked at once and found nothing still meet.

import {
  argsOf,
  type Bundle,
  type Graph,
  identityEid,
  Refused,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { terms } from './recall.ts'

export let TOPIC = 'topic'

/** How many topics a find returns when the caller gave no limit. */
export let FIND = 12

let str = (v: unknown): string => v == null ? '' : String(v)

/**
 * A topic's name: its title in lowercase, the spaces single.
 *
 * ```ts
 * named('  UI   Components ') // 'ui components'
 * ```
 */
export let named = (title: string): string =>
  title.trim().replace(/\s+/g, ' ').toLowerCase()

/** The id of the topic a title names, whether or not it exists yet. */
export let topicEid = (title: string): string =>
  identityEid(TOPIC, [named(title)])

let words = (said: string): string[] =>
  terms(said).toLowerCase().split(' ').filter(Boolean)

// Each word as the start of a word: a topic is found by what it is about, and
// "query" should find "querying" and "query grammar" alike.
let starts = (said: string): string => words(said).map((w) => `${w}*`).join(' ')

/**
 * Whether two names name one subject by their words: every word of one starts
 * a word of the other, or is started by one.
 *
 * ```ts
 * overlaps('economic market design', 'market design') // true
 * overlaps('tests', 'testing and ci') // false
 * overlaps('test', 'testing and ci') // true
 * overlaps('ui design', 'cover design') // false
 * ```
 */
export let overlaps = (a: string, b: string): boolean => {
  let holds = (xs: string[], ys: string[]) =>
    ys.every((y) => xs.some((x) => x.startsWith(y) || y.startsWith(x)))
  return holds(words(a), words(b)) || holds(words(b), words(a))
}

let brief = (t: Bundle): string => {
  let doc = (t.doc ?? {}) as { title?: string; body?: string }
  return `${t.entity.eid} (${str(doc.title)}: ${str(doc.body)})`
}

/**
 * The query string that finds topics: those holding a word starting with each
 * word given, ranked by meaning to `near`, or else in order of name.
 *
 * ```ts
 * found({ said: 'ui?', limit: 5 })
 * // 'ui*&.topic&*&.order=topic.name&.limit=5'
 * ```
 */
export let found = (
  o: { said?: string; near?: string; limit: number },
): string =>
  [
    ...(starts(o.said ?? '') ? [starts(o.said ?? '')] : []),
    ...(o.near ? [`.near=${o.near}`] : []),
    `.${TOPIC}`,
    '*',
    o.near ? '.order=similar' : `.order=${TOPIC}.name`,
    `.limit=${o.limit}`,
  ].join('&')

/** The implementations of `topic_new` and `topic_find`. */
export let topics = (): Runs => ({
  topic_new: async (call, graph: Graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let title = str(args.name).trim().replace(/\s+/g, ' ')
    let body = str(args.body).trim()
    if (!title) throw new Refused('a topic needs a name')
    if (!body) {
      throw new Refused('a topic needs a brief saying what belongs under it')
    }
    let [held] = await graph.get([topicEid(title)])
    if (held && !held.tombstone) {
      throw new Refused(
        `the topic ${named(title)} is ${brief(held)} already; use it`,
      )
    }
    // Every topic, by name: they are few and broad, and a word longer than
    // theirs ("markets" for "market design") no prefix search finds.
    let same = (await graph.read(`.${TOPIC}&*&.limit=100000`)).filter((t) =>
      overlaps(title, str((t[TOPIC] as { name?: unknown })?.name))
    )
    if (same.length) {
      throw new Refused(
        `${named(title)} names the subject of ${
          same.map(brief).join(', ')
        }; use it, or a name that holds none of its words`,
      )
    }
    // Its id, not an alias: the name decides it, and the caller is answered
    // what was written, so a model reading the answer learns the id to use.
    return [{
      entity: { eid: topicEid(title) },
      [TOPIC]: { name: named(title) },
      doc: { title, body },
    }]
  },

  topic_find: async (call, graph: Graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    return await graph.read(found({
      said: str(args.said),
      near: str(args.near),
      limit: Number(args.limit ?? FIND),
    }))
  },
})
