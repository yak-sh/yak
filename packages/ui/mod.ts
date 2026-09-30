/**
 * @yaks/ui: the UI components. Each is a named part with semantic variants
 * (`Block_Element-modifier`), display only: no state, no graph, no outer
 * layout, and the same look wherever it sits. Each is a Preact component, a
 * CSS file and its terminal sheet entries, so it paints in a browser and in
 * @yaks/tui alike.
 *
 * - `el`, `block`: the builders every part is made from (el.ts).
 * - `Dot`, `Id`, `Stamp`, `Tabs`, `Menu`, `Tip`, `Field`, `Choices`, `Button`,
 *   `Chip`, `Value`, `Pairs`, `Tile`, `Rows`, `Section`, `Timeline`, `Crumbs`,
 *   `Edit`, `Table`, `Pager`, `Panes`, `Head`, `Notes`, `Say`, `Index`: the
 *   parts.
 * - `relative`: a moment in words, what a `Stamp` says.
 * - `everforest`: the first theme; `stylesheet(theme)` dresses a browser,
 *   `sheet(theme)` a terminal (kit.ts).
 * - `Guide`: every part in every variant, the page `./routes` serves at `/ui`.
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
export { Button } from './Button.ts'
export { Chip, hues } from './Chip.ts'
export { Crumbs } from './Crumbs.ts'
export { Edit } from './Edit.ts'
export { Head } from './Head.ts'
export { Index } from './Index.ts'
export { Notes } from './Notes.ts'
export { Pager } from './Pager.ts'
export { Panes } from './Panes.ts'
export { Say } from './Say.ts'
export { type Col, Table, type TableProps } from './Table.ts'
export { Pairs } from './Pairs.ts'
export { Rows } from './Rows.ts'
export { Section } from './Section.ts'
export { Tile } from './Tile.ts'
export { Timeline } from './Timeline.ts'
export { Value } from './Value.ts'
export { everforest } from './everforest.ts'
export { kit, sheet, stylesheet } from './kit.ts'
export { Guide } from './guide.ts'
export type { Colors, Kit, Specimen, Theme } from './theme.ts'
