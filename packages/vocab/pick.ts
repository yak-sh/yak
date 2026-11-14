// Some of a document's words, as a document of their own: how a program that
// speaks a few of a package's components loads them from their one home rather
// than declaring them again.

import type { KindDecl } from './kinds.ts'
import type { VocabDoc } from './types.ts'

/**
 * The document with only the components `keep` answers true for, and only the
 * kinds those still make: a kind is dropped with any component of its `is`
 * that the document declares. Everything else the document says stays, so two
 * narrowings of one document never declare one kind twice.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { narrow } from '@yaks/vocab'
 *
 * let work = {
 *   $defs: {
 *     task: { component: true, type: 'object', properties: {} },
 *     decision: { component: true, type: 'object', properties: {} },
 *   },
 *   kinds: { task: {}, decision: { is: ['task', 'decision'] } },
 * }
 * assertEquals(Object.keys(narrow(work, (n) => n == 'task').kinds!), ['task'])
 * ```
 */
export let narrow = (
  doc: VocabDoc,
  keep: (name: string) => boolean,
): VocabDoc => {
  let defs = doc.$defs ?? {}
  let { kinds, ...rest } = doc
  let held = Object.entries((kinds ?? {}) as Record<string, KindDecl>)
    .filter(([name, k]) =>
      (k.is ?? [name]).every((c) => !Object.hasOwn(defs, c) || keep(c))
    )
  return {
    ...rest,
    $defs: Object.fromEntries(Object.entries(defs).filter(([n]) => keep(n))),
    ...held.length ? { kinds: Object.fromEntries(held) } : {},
  }
}

/**
 * The components `names` from `doc`, under a title of their own, with the
 * kinds they make (see `narrow`): the same declarations, read by a program
 * that wants those words and not the rest of the package's. A name the
 * document does not declare throws, so a word that moved or was renamed at its
 * home is found when the pick is made, not missed.
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
  let { $defs, kinds } = narrow(doc, (n) => names.includes(n))
  return {
    ...(doc.$vocabulary ? { $vocabulary: doc.$vocabulary } : {}),
    ...(doc.package ? { package: doc.package } : {}),
    ...(title ? { title } : {}),
    $defs: Object.fromEntries(names.map((n) => [n, $defs![n]])),
    ...(kinds ? { kinds } : {}),
  }
}
