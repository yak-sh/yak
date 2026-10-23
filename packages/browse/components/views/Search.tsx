// Search is a renderer context, not a second entity drawing in the screen.
// Delegate the entity shape to Tile, with what was sought in the context
// (`words`) and its matches in the same slots all tiles share: a title marked
// where the words are in it, and under a tile that draws no passage of its
// own, the passage of its text that the words matched. A passage row (words
// someone said, a long text) marks its own passage from `words`.
import type { Ent } from '../../types.ts'
import { vocab } from '../../types.ts'
import { marked, Passage } from '@yaks/ui'
import { hit, snippet } from '@yaks/graph/hit'
import { bundle, renderView } from '../registry.ts'
import type { TileSlots } from '../Tile.tsx'
import { unmime } from '../../rfc2047.ts'

let matched = (cut: string) => cut.includes('\x01')

/** The slots a tile wears in the results of a search for `words`. */
export let hitSlots = (e: Ent, words: string[]): TileSlots => {
  if (!words.length) return {}
  let title = e.doc?.title ?? ''
  let named = snippet(e.mail ? unmime(title) : title, words)
  // A yaks.app store cuts its own passage from its index (`rank.snip`).
  let cut = (e.rank as { snip?: unknown } | undefined)?.snip
  let passage = hit(vocab, words)(
    bundle(e),
    typeof cut == 'string' ? cut : undefined,
  ).snippet
  return {
    title: matched(named) ? marked(named) : undefined,
    body: matched(passage)
      ? (
        <Passage>
          <Passage.Text>{marked(passage)}</Passage.Text>
        </Passage>
      )
      : undefined,
  }
}

export let SearchTile = ({ e, words = [] }: { e: Ent; words?: string[] }) =>
  renderView(e, 'Tile', { slots: hitSlots(e, words), words })
