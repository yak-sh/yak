// Some of a document's words, as a document of their own: how a program that
// speaks a few of a package's components loads them from their one home rather
// than declaring them again.

import type { VocabDoc } from './types.ts'

/**
 * The components `names` from `doc`, under a title of their own: the same
 * declarations, read by a program that wants those words and not the rest of
 * the package's. A name the document does not declare throws, so a word that
 * moved or was renamed at its home is found when the pick is made, not missed.
 *
 * ```ts
 * import { assertEquals, assertThrows } from '@std/assert'
 * import { loadVocab, pick } from '@yaks/vocab'
 *
 * let work = {
 *   title: 'work',
 *   $defs: {
 *     task: { component: true, type: 'object', properties: {} },
 *     claim: { component: true, type: 'object', properties: {} },
 *   },
 * }
 * assertEquals(loadVocab(pick(work, ['task'])).all, ['task'])
 * assertThrows(() => pick(work, ['lease']), Error, 'work declares no lease')
 * ```
 */
export let pick = (
  doc: VocabDoc,
  names: string[],
  title = doc.title,
): VocabDoc => {
  let defs = doc.$defs ?? {}
  let missing = names.filter((n) => !Object.hasOwn(defs, n))
  if (missing.length) {
    throw new Error(
      `${doc.title ?? 'the document'} declares no ${missing.join(', ')}`,
    )
  }
  return {
    ...(doc.$vocabulary ? { $vocabulary: doc.$vocabulary } : {}),
    ...(doc.package ? { package: doc.package } : {}),
    ...(title ? { title } : {}),
    $defs: Object.fromEntries(names.map((n) => [n, defs[n]])),
  }
}
