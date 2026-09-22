/**
 * @yaks/code — a codebase, read into a graph.
 *
 * A package per manifest, a module per file, a symbol per export, and an
 * `imports` link per import, each with its text in `doc`, so full-text and
 * vector search find code by what its comments say. A module wears the
 * @yaks/git `file` it was read from, a symbol names its module, and every id
 * is derived from those declared identities, so reading the same tree twice
 * writes one set of entities.
 *
 * ```ts
 * import { codeSync } from '@yaks/code'
 *
 * // await codeSync({ graph, actor: null, cwd: '/home/me/project' })
 * // '/home/me/project: read 1204 files (6142 exports, …) in 21000 ms.'
 * ```
 *
 * The reading is a read-only @yaks/mirror binding: the files own the code,
 * and a file is read again only when its Git blob moved.
 *
 * @module
 */

export * from './read.ts'
export * from './sync.ts'
export * from './tools.ts'
export * from './vocab.ts'
