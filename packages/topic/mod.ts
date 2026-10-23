/**
 * @yaks/topic — a knowledge graph of topics. A topic is a subject:
 * `topic{name}` beside `doc{title, body}`, its cover, and `content{body}`,
 * its contents; a project is its own topic, and a topic belongs to whatever
 * contains it. Its edges say what it holds (`contains`: a subtopic, or any
 * other entity), what to understand first (`requires`), what it reads and
 * references, and the sources it cites (`cites{hash}`); those relations are
 * @yaks/task's and @yaks/kernel's, and nothing here copies them.
 *
 * A topic is also a session's context: a session opened on one
 * (`session.topic`) wears the {@link ORACLE} persona and starts from the
 * topic's tree, read by `gather` and written as markdown by `compile`.
 *
 * ```ts
 * import { fits, named, overlaps } from '@yaks/topic'
 *
 * named('Data  Model') // 'data model'
 * overlaps('economic market design', 'market design') // true
 * fits('data modeling', 'data model') // true
 * ```
 *
 * The tools, `topic_find`, `topic_new`, `topic_add` and `topic_read`, are
 * `@yaks/topic/tools`.
 *
 * @module
 */

export {
  about,
  FIND,
  fits,
  found,
  HOLDS,
  named,
  ORACLE,
  overlaps,
  TOPIC,
  TOPICS,
} from './topic.ts'
export {
  type Branch,
  BUDGET,
  compile,
  CUT,
  cut,
  gather,
  type Gathered,
  GIST,
  LEVELS,
  LINES,
} from './context.ts'
export { type Shelf, shelves, within } from './shelves.ts'
export { topicDoc } from './vocab.ts'
