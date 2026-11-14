/**
 * @yaks/ui: the UI components. Each is a named part with semantic variants
 * (`Block_Element-modifier`), display only: no state, no graph, no outer
 * layout, and the same look wherever it sits. Each is a Preact component, a
 * CSS file and its terminal sheet entries, so it paints in a browser and in
 * @yaks/tui alike.
 *
 * - `el`, `block`: the builders every part is made from (el.ts).
 * - `Dot`, `Id`, `Stamp`, `Time`, `Tabs`, `Menu`, `Tip`, `Field`, `At`, `Check`,
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

export * from './parts.ts'
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
