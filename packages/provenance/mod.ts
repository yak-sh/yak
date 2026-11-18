/**
 * Who made an entity and who last changed it: `created{at, by, via}` is set
 * once, when the entity is made, and `updated{at, by, via}` on every later
 * write. @yaks/graph's stamp phase fills both in for whatever vocabulary
 * declares them, so a graph composed without this package keeps no stamps.
 *
 * The optional graph facet retains the writers of surviving words and values
 * as `authorship{fields}`; reading only the vocabulary retains just the stamps.
 */

export { provenanceDoc } from './vocab.ts'
