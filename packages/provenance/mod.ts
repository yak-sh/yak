/**
 * Who made an entity and who last changed it: `created{at, by, via}` is set
 * once, when the entity is made, and `updated{at, by, via}` on every later
 * write. @yaks/graph's stamp phase fills both in for whatever vocabulary
 * declares them, so a graph composed without this package keeps no stamps.
 *
 * Components only: a vocabulary document, with no code.
 */

export { provenanceDoc } from './vocab.ts'
