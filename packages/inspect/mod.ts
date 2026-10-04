/**
 * Inspect views: entities, vocabulary components, packages, properties, query
 * rows and the map. A host mounts these registrations in its shared registry,
 * answers their declared queries and applies emitted bundles. Browse owns the
 * sidebar, navigation and stack; web and tui are its doors.
 * @module
 */

export { type DoorProps, type Inspector, inspector } from './door.ts'
export { note, Part, type PartProps, useNamed } from './notes.ts'
export { type PageCtx, usePageNotes } from './Entity.ts'
export type { HeadCtx } from './Head.ts'
export type { FactsCtx } from './Facts.ts'
export type { LinksCtx } from './Links.ts'
export { mention, reads } from './value.ts'
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
export { all, composed, views } from './views.ts'

export { called } from './read.ts'

export { useCensus, type Census } from './census.ts'
