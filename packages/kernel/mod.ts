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
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

export { KERNEL_URI, kernelKeywords } from './keywords.ts'

/** The kernel vocabulary, as the document `loadVocab` takes. */
export let kernelDoc: VocabDoc = doc as VocabDoc

/** Just the spine and the two stamps every graph wants, for a host that takes
 * the base words without the rest of the kernel's: `entity{num, archetype}`,
 * `created{at, by, via}` and `updated{at, by, via}`. */
export let spineDoc: VocabDoc = {
  title: 'spine',
  $defs: Object.fromEntries(
    ['entity', 'created', 'updated'].map((
      n,
    ) => [n, (doc.$defs as Record<string, unknown>)[n]]),
  ),
} as VocabDoc
