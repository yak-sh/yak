// Names in the stored layout, shared by reading and schema installation.
import type { Vocab } from '@yaks/vocab'

/**
 * The key/value table's name. Named `server_meta`, not `meta`, because a
 * vocabulary may well declare a `meta` component and the two must never collide
 * — and because that is the name the fleet's live table already carries, so
 * installing over one adopts it instead of creating a second.
 */
export let META = 'server_meta'

let tableNames = new WeakMap<Vocab, string[]>()
/** The components that have a table of their own: every one but the spine
 * and the computed ones, whose rows another package keeps (@yaks/sql
 * `Backing`). */
export let tables = (vocab: Vocab): string[] => {
  let names = tableNames.get(vocab)
  if (!names) {
    names = vocab.all.filter((name) =>
      name != 'entity' && !vocab.comp(name)?.computed
    )
    tableNames.set(vocab, names)
  }
  return [...names]
}
