// WHICH columns are content-addressed. The vocabulary carries the `store`
// keyword; this module is the one place that reads it, so every other module
// here asks a question ("is this column a body?", "which are they?") instead of
// rummaging through schemas.
//
// A column marked `store: "blob"` is an ordinary string column in every other
// respect — it is declared, validated, queried and written as text. Only where
// the value LIVES differs, and that is this package's whole subject.

import type { Column, Vocab } from '@yaks/vocab'

/** One content-addressed column, named the way a vocabulary names it. */
export type Body = { comp: string; prop: string }

/** Whether a column keeps its value in a content-addressed store. */
export let isBody = (column: Column | undefined): boolean =>
  column?.keywords?.store == 'blob'

/**
 * Every content-addressed column in a vocabulary, by component then
 * declaration order. Requires the vocabulary to have been loaded with
 * {@link blobKeywords} — without the registration the loader carries no
 * `store` word and this answers empty, which is the honest reading of a
 * vocabulary that never declared one.
 */
export let bodies = (vocab: Vocab): Body[] =>
  vocab.all.flatMap((comp) =>
    vocab.columns(comp)
      .filter((prop) => isBody(vocab.column(comp, prop)))
      .map((prop) => ({ comp, prop }))
  )
