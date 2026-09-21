/**
 * The base words a graph of work wears: the spine (`entity`) and the marks
 * every entity may carry — who made it and when (`created`, `updated`), what
 * was decided about it (`proposed`, `decided`, `quarantined`), what it is
 * attached to (`comment`, `image`, `favorite`) — plus the
 * relation tags an edge says (`about`, `reads`, `references`, `supersedes`, …).
 *
 * It ships almost no machinery: a vocabulary document, the four keywords that
 * describe what the core meta-model does not (see {@link kernelKeywords}), and
 * the one thing the spine implies — the human id (`T-37580`) a person types,
 * addressed back to the entity that wears that number (see {@link ids}).
 *
 * Who signs a write no door authenticated is NOT here and is not a name: it is
 * the `process` row this run wrote (@yaks/process `started`), because a run of
 * a program is not a singleton and two `yak` lines over one file are two
 * writers.
 */
export { KERNEL_URI, kernelKeywords } from './keywords.ts'
export { kernelDoc, marksDoc, spineDoc } from './vocab.ts'
export { ids } from './ids.ts'
