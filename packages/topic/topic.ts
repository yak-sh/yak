// A topic's name and the query that finds topics: the pure half of the
// package, which ./tools.ts reads and writes with.
//
// The one danger is synonyms. A model names a subject by what it means, not by
// its letters, so left alone it calls the same subject "testing" in one build,
// "tests" in the next and "test suite" in a third, and what is known about it
// scatters across three topics that each hold a third (M-12915 on why). Three
// things stand against that. A topic's name is unique (`topic.name`'s index),
// folded to lowercase with single spaces, so a name said twice is one topic
// whoever says it, and the second of two builds at once is refused; whoever
// makes one is shown the topics that exist, nearest its words by meaning,
// first, so it reuses a subject already named; and `topic_new` refuses a name
// that is taken, or whose words hold another topic's or are held by them
// ("economic market design" beside "market design"), and says which topic to
// use. The name is not the topic's identity: any entity may wear `topic`, a
// project to be its own topic, and keeps its eid when its name changes.

import type { Bundle } from '@yaks/graph'
import { tokens } from '@yaks/match'
import { stemmer } from 'stemmer'

/** The component this package is about. */
export let TOPIC = 'topic'

/** The relation from a topic to what it holds (@yaks/task's word). */
export let HOLDS = 'contains'

/** The relation from a persona to the topic it looks after, its oracle. */
export let TENDS = 'tends'

/** How many topics a find returns when the caller gave no limit. */
export let FIND = 12

/** How many topics a reading of every one reads at most: they are few and
 * broad, so a find reads them all and matches the words here. */
export let TOPICS = 100000

/**
 * A topic's name: its title in lowercase, the spaces single.
 *
 * ```ts
 * named('  UI   Components ') // 'ui components'
 * ```
 */
export let named = (title: string): string =>
  title.trim().replace(/\s+/g, ' ').toLowerCase()

let prop = (t: Bundle, comp: string, name: string): string => {
  let v = (t[comp] as Record<string, unknown> | undefined)?.[name]
  return typeof v == 'string' ? v : ''
}

/** What a topic is called: its cover's title, else its name. */
/// title({ entity: { eid: 'q' }, topic: { name: 'data model' } }) -> 'data model'
export let title = (t: Bundle): string =>
  prop(t, 'doc', 'title') || prop(t, TOPIC, 'name')

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
 * Whether what was said finds a topic's words: each word said starts one of
 * them, as it is typed ("dat" finds "data"), or shares its stem ("data
 * modeling" finds "data model", "tests" finds "testing"). Nothing said finds
 * every topic.
 */
/// fits('data modeling', 'data model') -> true
/// fits('Tests', 'what a test checks') -> true
/// fits('dat mod', 'data model') -> true
/// fits('data storage', 'data model') -> false
/// fits('', 'anything') -> true
export let fits = (said: string, text: string): boolean => {
  let have = tokens(text)
  let stems = have.map((t) => stemmer(t))
  return tokens(said).every((w) => {
    let stem = stemmer(w)
    return have.some((t, i) => t.startsWith(w) || stems[i].startsWith(stem))
  })
}

/** The words a topic is found by: its name, its title and its cover. */
/// about({ entity: { eid: 'q' }, topic: { name: 'data model' }, doc: { title: 'Data model', body: 'How data is shaped.' } })
///   -> 'data model Data model How data is shaped.'
export let about = (t: Bundle): string =>
  [prop(t, TOPIC, 'name'), prop(t, 'doc', 'title'), prop(t, 'doc', 'body')]
    .filter(Boolean).join(' ')

/**
 * The query string that reads every topic with its name and cover, ranked by
 * meaning to `near`, or else in order of name. A find keeps those whose words
 * fit what was said (`fits`).
 *
 * ```ts
 * found({}) // '.topic&?doc&.order=topic.name&.limit=100000'
 * found({ near: 'T-9' })
 * // '.near=T-9&.topic&?doc&.order=similar&.limit=100000'
 * ```
 */
export let found = (o: { near?: string }): string =>
  [
    ...(o.near ? [`.near=${o.near}`] : []),
    `.${TOPIC}`,
    '?doc',
    o.near ? '.order=similar' : `.order=${TOPIC}.name`,
    `.limit=${TOPICS}`,
  ].join('&')
