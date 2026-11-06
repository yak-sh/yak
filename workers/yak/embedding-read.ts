// Stored text selection and semantic ranking, independent of model bindings.
import {
  type Embedder,
  type Field,
  fields,
  meaning,
  resolved,
  searched,
} from '@yaks/embedding'
import type { Meaning } from '@yaks/host'
import type { Derived, Raw, Statements } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

/** The text a store embeds: every property its vocabulary marks searched,
 * read through its derived columns, so a body kept by address is its prose. */
export let texts = (vocab: Vocab, derived: Derived): Field[] =>
  resolved(fields(vocab, searched), derived)

/** Words ranked by meaning among what a filter line selects (@yaks/host
 * `meaning`), what a memory recall asks (@yaks/memory): the words embedded by
 * the model `model` answers, none ranking nothing, and the vectors in `held`
 * scanned. Both are read at each call, since a store's texts stand up after it
 * does. */
export let ranking = (
  model: () => Embedder | null,
  held: {
    statements: Statements
    fields: Field[]
    screen: (line: string) => Raw | null
  },
  search: typeof meaning = meaning,
): Meaning =>
async (words, { limit, within } = {}) => {
  let embeds = model()
  if (!embeds) return []
  let { statements, fields, screen } = held
  return await search(statements, fields, embeds, words, {
    limit,
    screen: within ? () => screen(within) : undefined,
  })
}
