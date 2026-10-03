import type { Bundle } from '@yaks/graph'
import { reserved } from '@yaks/graph'
import { syncOf, type Vocab } from '@yaks/vocab'

/** The bundles a transport may send. A `sync: none` component belongs to
 * this node alone; identities, pipeline metadata and every other component
 * retain their values, including server-owned stamps and deletion markers.
 * This projection never changes the graph's stored or applied bundles. */
export let published = (vocab: Vocab, bundles: Bundle[]): Bundle[] =>
  bundles.map((b) =>
    Object.fromEntries(
      Object.entries(b).filter(([name]) =>
        reserved(name) || syncOf(vocab, name) != 'none'
      ),
    ) as Bundle
  )
