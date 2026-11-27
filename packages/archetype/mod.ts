/**
 * Content-addressed component sets, cached presence matching and moves, and
 * the graph plugin that maintains an entity's archetype. A set's components'
 * identities, not their labels, define its identity. No query lowering or
 * platform APIs.
 * @module
 */
export * from './sets.ts'
export * from './plugin.ts'
