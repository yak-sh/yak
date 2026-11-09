/**
 * @yaks/ui: the UI components. Each is a named part with semantic variants
 * (`Block_Element-modifier`), display only: no state, no graph, no outer
 * layout, and the same look wherever it sits. Each is a Preact component, a
 * CSS file and its terminal sheet entries, so it paints in a browser and in
 * @yaks/tui alike.
 *
 * - `el`, `block`: the builders every part is made from (el.ts).
 * - `Dot`, `Id`, `Stamp`, `Tabs`, `Menu`, `Tip`, `Field`, `At`, `Check`,
 *   `Form`, `Drop`, `Notice`, `More`, `Choices`, `Button`,
 *   `Chip`, `Match`, `Value`, `Pairs`, `Tile`, `Rows`, `Section`, `Timeline`,
 *   `Turns`, `Passage`, `Body`, `Doc`, `Quote`, `Edit`, `Prop`, `Overlay`, `Peek`, `Table`, `Pager`, `Shell`,
 *   `Panes`, `Head`, `Metrics`, `Spark`, `Notes`,
 *   `Chips`, `Address`, `Icon`, `Copy`, `Card`, `Report`, `Group`, `Empty`,
 *   `State`, `Loading`, `Sparkline`, `Columns`,
 *   `Say`, `Index`, `SideNav`, `Catalog`, `Gallery`, `Cards`: the parts (`TabSet`
 *   is `Tabs` holding their panels); `groups`, the parts by
 *   what they are for, and `kit`, all of them (kit.ts).
 * - `Float`, `place`, `placeAt`, `usePlaceAt`, `tips`: what floats above a
 *   browser's page, clear of every clipping container (float.ts), the
 *   browser's form of the popover primitive a UX component (@yaks/ux) is
 *   handed.
 * - `relative`: a moment in words, what a `Stamp` says.
 * - `themes`: every theme by name, `gouache` (the default), `everforest`,
 *   `rosepine` and `linen`, yaks.app's; `skins`, `paper` (the default),
 *   `ledger` and `pencil`, yaks.app's; `composition`, the kits in the
 *   defaults; `stylesheet(composition)` dresses a browser (`sheets`, the
 *   same sheet by what each piece dresses), `sheet(composition)` a terminal
 *   and `native(composition)` a native host (kit.ts).
 * - `Guide`: every part in every variant, the guide `./routes` serves at `/ui`
 *   and `./cli` paints as `yak ui`; `Specimens`, one part's entry in it;
 *   `Worn`, the entries of the parts a host wears, for a guide of its own.
 *
 * @module
 */

export { block, el, type Part, type Props, Surround } from './el.ts'
export { Dot, shapes, tones } from './Dot.ts'
export { Id } from './Id.ts'
export { Menu } from './Menu.ts'
export { Stamp } from './Stamp.ts'
export { State } from './State.ts'
export { relative } from './relative.ts'
export { half, halved } from './halved.ts'
export { Tabs, TabSet } from './Tabs.ts'
export { Tip } from './Tip.ts'
export { Field, type FieldProps } from './Field.ts'
export { At } from './At.ts'
export { Check } from './Check.ts'
export { Drop } from './Drop.ts'
export { Form } from './Form.ts'
export { More } from './More.ts'
export { Notice } from './Notice.ts'
export { Choices } from './Choices.ts'
export { Body } from './Body.ts'
export { Doc } from './Doc.ts'
export { Button } from './Button.ts'
export { Card } from './Card.ts'
export { Catalog } from './Catalog.ts'
export { Chip, hues } from './Chip.ts'
export { Chips } from './Chips.ts'
export { Cards, Cards as Grid } from './Cards.ts'
export { Copy } from './Copy.ts'
export { Address } from './Address.ts'
export { Icon, type IconProps } from './Icon.ts'
export { Edit } from './Edit.ts'
export { Empty } from './Empty.ts'
export { Gallery } from './Gallery.ts'
export { Group } from './Group.ts'
export { Head } from './Head.ts'
export { Index } from './Index.ts'
export { Inbox } from './Inbox.ts'
export { marked, Match } from './Match.ts'
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
export { Report } from './Report.ts'
export { Say } from './Say.ts'
export { type Col, Table, type TableProps } from './Table.ts'
export { Pairs } from './Pairs.ts'
export { Passage } from './Passage.ts'
export { Rows } from './Rows.ts'
export { Section } from './Section.ts'
export { Shell } from './Shell.ts'
export { SideNav } from './SideNav.ts'
export { Tile } from './Tile.ts'
export { Timeline } from './Timeline.ts'
export { Turns } from './Turns.ts'
export { Value } from './Value.ts'
export { Meter } from './Meter.ts'
export { Spark } from './Spark.ts'
export { bars } from './chart-marks.ts'
export { Columns, Sparkline } from './Chart.ts'
export { Metrics } from './Metrics.ts'
export { everforest } from './everforest.ts'
export { gouache } from './gouache.ts'
export { linen } from './linen.ts'
export { rosepine } from './rosepine.ts'
export {
  composition,
  gather,
  groups,
  kit,
  kits,
  native,
  parts,
  sheet,
  sheets,
  skins,
  stylesheet,
  themes,
} from './kit.ts'
export { Guide, Specimens, Worn } from './guide.ts'
export type {
  Behaviours,
  Colors,
  Composition,
  Contributions,
  Kit,
  Native,
  Piece,
  Skin,
  Specimen,
  Style,
  Theme,
} from './theme.ts'

export { ledger } from './ledger.ts'
export { paper } from './paper.ts'
export { pencil } from './pencil.ts'
export { installViewport, Viewport, type ViewportProps } from './viewport.ts'

export { Loading } from './Loading.ts'
export { Palette } from './Palette.ts'
export { Peek } from './Peek.ts'
