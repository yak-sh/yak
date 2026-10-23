/**
 * Inspect views: entities, vocabulary components, packages, properties,
 * effects, query rows and the map. A host mounts these registrations in its shared registry,
 * answers their declared queries and applies emitted bundles. Browse owns the
 * sidebar and navigation; web and tui are its doors.
 * @module
 */

export { type DoorProps, type Inspector, inspector } from './door.ts'
export { note, Part, type PartProps, useNamed } from './notes.ts'
export { type PageCtx, usePageNotes } from './Entity.ts'
export {
  type Change,
  Past,
  type PastProps,
  type Version,
  version,
  VERSIONS,
  versions,
} from './Past.ts'
export type { HeadCtx } from './Head.ts'
export type { FactsCtx } from './Facts.ts'
export type { LinksCtx } from './Links.ts'
export { mention, reads } from './value.ts'
export { effectEid } from './schema.ts'
export type {
  Answer,
  Ask,
  Asks,
  Bundle,
  Front,
  Host,
  Io,
  Props,
  View,
} from './host.ts'
export { edited, editing, INSPECT } from './state.ts'
export { all, composed, schemaPages, views } from './registry.ts'

export { called, face, leaves, shape } from './read.ts'

export { type Census, useCensus } from './census.ts'
export { type Reader, type Reading, useReading, whole } from './reading.ts'
