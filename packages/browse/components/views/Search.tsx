// Search is a renderer context, not a second entity drawing in the screen.
// Delegate the entity shape to Tile, with its ranked matches in the same slots
// all tiles share. Both the palette and the addressed search page ask for this.
import type { Ent, Hit } from '../../types.ts'
import { Value } from '@yaks/ui'
import { renderView } from '../registry.ts'

let marked = (s: string) =>
  s.split('\x01').flatMap((chunk, i) => {
    if (!i) return [chunk]
    let [hit, rest] = chunk.split('\x02')
    return [<mark key={i}>{hit}</mark>, rest]
  })

export let hitSlots = (h: Hit) => ({
  title: marked(h.title_hit || h.title || '(untitled)'),
  body: <Value>{marked(h.snip)}{h.retired && ' · retired'}</Value>,
})

export let SearchTile = ({ e, hit }: { e: Ent; hit?: Hit }) =>
  renderView(e, 'Tile', hit ? { slots: hitSlots(hit) } : {})
