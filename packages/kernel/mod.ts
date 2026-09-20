/**
 * The base words a graph of work wears: the spine (`entity`) and the marks
 * every entity may carry — who made it and when (`created`, `updated`), what
 * was decided about it (`proposed`, `decided`, `quarantined`), what it is
 * attached to (`comment`, `image`, `favorite`) — plus the
 * relation tags an edge says (`about`, `reads`, `references`, `supersedes`, …).
 *
 * It ships no machinery: a vocabulary document and the four keywords that
 * describe what the core meta-model does not (see {@link kernelKeywords}).
 */
export { KERNEL_URI, kernelKeywords } from './keywords.ts'
export { kernelDoc, spineDoc } from './vocab.ts'
