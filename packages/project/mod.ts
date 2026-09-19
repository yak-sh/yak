/**
 * A portfolio. A `project` is what work is filed UNDER — `filed{project,
 * priority, domain, assignee}` is that filing, separate from being a task, so a
 * microtask can skip it. A `board` is a saved filter over the portfolio, never
 * a stored membership, and the one piece of machinery here refuses a board
 * whose query would quietly match nothing. A `venture` is a business being
 * built, with a phase rather than a status.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { edgeDoc, edgeKeywords } from '@yaks/edge'
 * import { taskDoc } from '@yaks/task'
 * import { projectDoc, projects } from '@yaks/project'
 *
 * let vocab = loadVocab([edgeDoc, taskDoc, projectDoc], [edgeKeywords])
 * // let g = graph({ storage, vocab, plugins: [projects(vocab)] })
 * ```
 *
 * @module
 */
export * from './comp.ts'
export * from './guard.ts'
export * from './plugin.ts'
