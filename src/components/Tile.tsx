// The List.Tile composition contract. A caller may adorn any tile before or
// after its own face, and hear its ordinary activation, without knowing which
// entity-specific renderer the registry chose.
import { type ComponentChildren } from 'preact'
import { type Ent } from '../types.ts'
import { clickProps } from './nav.tsx'
import { el } from './ui.tsx'

export type TileSlots = {
  before?: ComponentChildren
  after?: ComponentChildren
}

export type TileProps = {
  e: Ent
  slots?: TileSlots
  onOpen?: () => void
}

let Part = el('span', 'TileSlot')
export let TileSlot = (
  { name, children }: { name: keyof TileSlots; children: ComponentChildren },
) => <Part mod={name}>{children}</Part>

export let slot = (slots: TileSlots | undefined, name: keyof TileSlots) =>
  slots?.[name] != null && <TileSlot name={name}>{slots[name]}</TileSlot>

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
