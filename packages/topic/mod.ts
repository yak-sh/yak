/**
 * @yaks/topic — a knowledge graph of topics. A topic is a subject no project,
 * package, component or design already is: `topic{name, scope}` beside
 * `doc{title, body}`, its cover, and `content{body}`, its contents. Its edges
 * say what it holds (`contains`: a subtopic, or any other entity), what to
 * understand first (`requires`), what it reads and references, and the
 * sources it cites (`cites{hash}`); those relations are @yaks/task's and
 * @yaks/kernel's, and nothing here copies them.
 *
 * ```ts
 * import { named, overlaps, topicEid } from '@yaks/topic'
 *
 * named('Data  Model') // 'data model'
 * topicEid('Data Model') == topicEid('data model') // true
 * overlaps('economic market design', 'market design') // true
 * ```
 *
 * The tools, `topic_find` and `topic_new`, are `@yaks/topic/tools`.
 *
 * @module
 */

export { FIND, found, named, overlaps, TOPIC, topicEid } from './topic.ts'
export { topicDoc } from './vocab.ts'
