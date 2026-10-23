/**
 * @yaks/topic — a knowledge graph of topics. A topic is a subject:
 * `topic{name, scope}` beside `doc{title, body}`, its cover, and
 * `content{body}`, its contents; a project is its own topic. Its edges say
 * what it holds (`contains`: a subtopic, or any other entity), what to
 * understand first (`requires`), what it reads and references, and the
 * sources it cites (`cites{hash}`); those relations are @yaks/task's and
 * @yaks/kernel's, and nothing here copies them.
 *
 * ```ts
 * import { fits, named, overlaps } from '@yaks/topic'
 *
 * named('Data  Model') // 'data model'
 * overlaps('economic market design', 'market design') // true
 * fits('data modeling', 'data model') // true
 * ```
 *
 * The tools, `topic_find`, `topic_new` and `topic_add`, are
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
  overlaps,
  TENDS,
  TOPIC,
  TOPICS,
} from './topic.ts'
export { type Shelf, shelves, within } from './shelves.ts'
export { topicDoc } from './vocab.ts'
