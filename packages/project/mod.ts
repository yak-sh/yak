/**
 * A portfolio. A `project` is what work is filed under — `filed{project,
 * priority, domain, assignee}` is that filing, kept separate from being a task
 * so that a task can have none. A `board` is a saved filter over the portfolio
 * rather than a stored list of members, and the one piece of machinery here
 * refuses a board whose query would quietly match nothing. A project filed
 * under another project is its sub-project, so `.filed.project->P` is
 * everything under P, and {@link lineage} reads the way up. A `venture` is a
 * business being built, with a phase rather than a status.
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
export * from './tree.ts'
