/**
 * Who made an entity and who last changed it: `created{at, by, via}` is set
 * once, when the entity is made, and `updated{at, by, via}` on every later
 * write. @yaks/graph's stamp phase fills both in for whatever vocabulary
 * declares them, so a graph composed without this package keeps no stamps.
 *
 * `@yaks/provenance/tracker` retains the writers of surviving words and values
 * as `authorship{fields}` for a store that composes it; it is not a facet, so
 * listing this package keeps just the stamps.
 */

export { provenanceDoc } from './vocab.ts'
