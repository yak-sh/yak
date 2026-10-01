/**
 * @yaks/ui: the UI components. Each is a named part with semantic variants
 * (`Block_Element-modifier`), display only: no state, no graph, no outer
 * layout, and the same look wherever it sits. Each is a Preact component, a
 * CSS file and its terminal sheet entries, so it paints in a browser and in
 * @yaks/tui alike.
 *
 * - `el`, `block`: the builders every part is made from (el.ts).
 * - `Dot`, `Id`, `Stamp`, `Tabs`, `Menu`, `Tip`, `Field`, `Choices`, `Button`,
 *   `Chip`, `Value`, `Pairs`, `Tile`, `Rows`, `Section`, `Timeline`, `Turns`,
 *   `Body`, `Quote`, `Stack`,
 *   `Edit`, `Prop`, `Overlay`, `Table`, `Pager`, `Panes`, `Head`, `Notes`,
 *   `Say`, `Index`, `Catalog`, `Gallery`: the parts; `groups`, the parts by
 *   what they are for, and `kit`, all of them (kit.ts).
 * - `Float`, `place`, `placeAt`, `usePlaceAt`, `tips`: what floats above a
 *   browser's page, clear of every clipping container (float.ts), the
 *   browser's form of the popover primitive a UX component (@yaks/ux) is
 *   handed.
 * - `relative`: a moment in words, what a `Stamp` says.
 * - `themes`: every theme by name, `everforest` the first and `rosepine`;
 *   `stylesheet(composition)` dresses a browser, `sheet(composition)` a terminal (kit.ts).
 * - `Guide`: every part in every variant, the guide `./routes` serves at `/ui`
 *   and `./cli` paints as `yak ui`; `Specimens`, one part's entry in it.
 *
 * @module
 */

export { block, el, type Part, type Props, Surround } from './el.ts'
export { Dot, shapes, tones } from './Dot.ts'
export { Id } from './Id.ts'
export { Menu } from './Menu.ts'
export { relative, Stamp } from './Stamp.ts'
export { Tabs } from './Tabs.ts'
export { Tip } from './Tip.ts'
export { Field, type FieldProps } from './Field.ts'
export { Choices } from './Choices.ts'
export { Body } from './Body.ts'
export { Button } from './Button.ts'
export { Catalog } from './Catalog.ts'
export { Chip, hues } from './Chip.ts'
export { Edit } from './Edit.ts'
export { Gallery } from './Gallery.ts'
export { Head } from './Head.ts'
export { Index } from './Index.ts'
export { Notes } from './Notes.ts'
export { Overlay } from './Overlay.ts'
export {
  Float,
  type FloatProps,
  place,
  placeAt,
  tips,
  usePlaceAt,
} from './float.ts'
export { Pager } from './Pager.ts'
export { Panes } from './Panes.ts'
export { Prop } from './Prop.ts'
export { Quote } from './Quote.ts'
export { Say } from './Say.ts'
export { type Col, Table, type TableProps } from './Table.ts'
export { Pairs } from './Pairs.ts'
export { Rows } from './Rows.ts'
export { Section } from './Section.ts'
export { Stack } from './Stack.ts'
export { Tile } from './Tile.ts'
export { Timeline } from './Timeline.ts'
export { Turns } from './Turns.ts'
export { Value } from './Value.ts'
export { everforest } from './everforest.ts'
export { rosepine } from './rosepine.ts'
export {
  composition,
  gather,
  groups,
  kit,
  kits,
  parts,
  sheet,
  skins,
  stylesheet,
  themes,
} from './kit.ts'
export { Guide, Specimens } from './guide.ts'
export type {
  Behaviours,
  Colors,
  Composition,
  Contributions,
  Kit,
  Piece,
  Skin,
  Specimen,
  Theme,
} from './theme.ts'
