// A topic's name, its id, and the query that finds topics: the pure half of
// the package, which ./tools.ts reads and writes with.
//
// The one danger is synonyms. A model names a subject by what it means, not by
// its letters, so left alone it calls the same subject "testing" in one build,
// "tests" in the next and "test suite" in a third, and what is known about it
// scatters across three topics that each hold a third (M-12915 on why). Three
// things stand against that. A topic's name is its identity (`topic.name`
// derives its id), folded to lowercase with single spaces, so a name said twice
// is one topic whoever says it, even two builds at once; whoever makes one is
// shown the topics that exist, nearest its words by meaning, first, so it
// reuses a subject already named; and `topic_new` refuses a name that is taken,
// or whose words hold another topic's or are held by them ("economic market
// design" beside "market design"), and says which topic to use.

import { identityEid } from '@yaks/graph/identity'
import { tokens } from '@yaks/match'

/** The component this package is about. */
export let TOPIC = 'topic'

/** How many topics a find returns when the caller gave no limit. */
export let FIND = 12

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

// Each word as the start of a word: a topic is found by what it is about, and
// "query" should find "querying" and "query grammar" alike.
let starts = (said: string): string =>
  tokens(said).map((w) => `${w}*`).join(' ')

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
  return holds(tokens(a), tokens(b)) || holds(tokens(b), tokens(a))
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
