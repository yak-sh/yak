// The Tile composition contract. A caller may adorn any tile before or
// after its own face, and hear its ordinary activation, without knowing which
// entity-specific renderer the registry chose.
import { type ComponentChildren } from 'preact'
import { type Ent } from '../types.ts'
import { clickProps } from './nav.tsx'
import { title } from './title.tsx'
import { block, el } from './ui.tsx'

export type TileSlots = {
  before?: ComponentChildren
  title?: ComponentChildren
  body?: ComponentChildren
  after?: ComponentChildren
}

export type TileProps = {
  e: Ent
  slots?: TileSlots
  onOpen?: () => void
}

export let TileFrame = block('div', 'Tile', { Head: 'span', Title: 'span' })

let Part = el('span', 'TileSlot')
export let TileSlot = (
  { name, children }: { name: keyof TileSlots; children: ComponentChildren },
) => <Part mod={name}>{children}</Part>

export let slot = (slots: TileSlots | undefined, name: keyof TileSlots) =>
  slots?.[name] != null && <TileSlot name={name}>{slots[name]}</TileSlot>

// A face keeps ownership of its title element (and therefore its density and
// wrapping); a surround may replace only the words inside it.
export let tileTitle = (slots: TileSlots | undefined, text: string) =>
  slots?.title != null ? { children: slots.title } : title(text)

export let tileLink = (e: Ent, onOpen?: () => void) => {
  let link = clickProps(e)
  return {
    ...link,
    onClick: (ev: MouseEvent) => {
      onOpen?.()
      link.onClick(ev)
    },
  }
}
