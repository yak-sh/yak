// Which properties are content-addressed. The vocabulary carries the `store`
// keyword; this module is the one place that reads it, so every other module
// here calls a function ("is this property a body?", "which are they?") instead
// of digging through schemas itself.
//
// A property marked `store: "blob"` is an ordinary string property in every
// other respect — it is declared, validated, queried and written as text. Only
// where the value lives differs, and that is this package's whole subject.

import type { Prop, Vocab } from '@yaks/vocab'

/** One content-addressed property, named the way a vocabulary names it. */
export type Body = { comp: string; prop: string }

/** Whether a property keeps its value in a content-addressed store. */
export let isBody = (prop: Prop | undefined): boolean =>
  prop?.keywords?.store == 'blob'

/**
 * Every content-addressed property in a vocabulary, by component then
 * declaration order. Requires the vocabulary to have been loaded with
 * {@link blobKeywords} — without that registration the loader does not carry
 * the `store` keyword at all, and this returns an empty list, which is the
 * correct reading of a vocabulary that never declared one.
 */
export let bodies = (vocab: Vocab): Body[] =>
  vocab.all.flatMap((comp) =>
    vocab.props(comp)
      .filter((prop) => isBody(vocab.prop(comp, prop)))
      .map((prop) => ({ comp, prop }))
  )

/**
 * Every stored property whose value names bytes in the store: the bodies, and
 * the properties declaring `address: true`, whose package wrote the bytes and
 * keeps their address itself. While a row of one names an address, its bytes
 * are kept.
 */
export let holders = (vocab: Vocab): Body[] =>
  vocab.all.flatMap((comp) =>
    vocab.props(comp)
      .filter((prop) => {
        let p = vocab.prop(comp, prop)
        return !p?.computed && (isBody(p) || p?.keywords?.address === true)
      })
      .map((prop) => ({ comp, prop }))
  )
