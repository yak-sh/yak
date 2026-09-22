/**
 * The components most graphs of work need: the `entity` row every entity has,
 * the marks recording what happened to a thing and who did it (`created`,
 * `updated`, `proposed`, `decided`, `quarantined`), the things that attach to
 * an entity (`comment`, `image`, `favorite`), and the tags that give an edge
 * its meaning (`about`, `reads`, `references`, `supersedes`, …).
 *
 * It ships no code beyond a vocabulary document and the three keywords that
 * describe what the core meta-model does not (see {@link kernelKeywords}). The
 * `entity` row is the identity row every entity has; what is KEPT beside the
 * eid is each plugin's own — the archetype is @yaks/archetype's word and the
 * number a human id is built from is @yaks/id's.
 *
 * Who a write is signed as is not here, and it is not a name out of a config
 * file: a write that did not arrive through an authenticated HTTP or MCP
 * request is signed as the `process` row this run wrote about itself
 * (@yaks/process `started`), because a program that runs twice is two writers —
 * two `yak` commands over one database file are two of them.
 */
export { KERNEL_URI, kernelKeywords } from './keywords.ts'
export { kernelDoc, marksDoc, spineDoc } from './vocab.ts'
