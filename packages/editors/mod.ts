/**
 * @yaks/editors: a property's value, changed where it stands. A domain
 * component with no store of its own: every editor reads and writes through
 * the page's host, bound once (`bind`), and draws with @yaks/ui's parts.
 *
 * - `Prop`: a value that opens its own editor when pressed, its face and its
 *   editor selected by the property's type through a registry.
 * - `Edit`, `InlineEdit`: a value typed over in place, the same element, so
 *   nothing moves; Enter or leaving writes it, Escape puts it back, and a
 *   draft outlives a remount.
 * - `ColumnEdit`: a property's editor opened by its caller, anchored where
 *   the caller says.
 * - `editorViews`, `views`: the editors as registrations (./views.ts, the
 *   `/views` facet).
 * - `Overlay`, `place`, `placeAt`, `usePlaceAt`, `tips`: what floats above
 *   the page, clear of every clipping container.
 * - `save`, `peek`, `drop`, `focused`, `useDraft`: half-typed text, kept per
 *   tab until it is written or put back.
 * - `pickLine`, `useHits`, `label`: a picker's candidates, asked of the
 *   graph through the host's `find`.
 * - `bind`, `Host`: what a page supplies.
 *
 * @module
 */

export { bind, type Bundle, type Host, host } from './host.ts'
export type { Editor } from './types.ts'
export { InlineEdit, type InlineEditProps } from './Edit.ts'
export {
  ColumnEdit,
  columnView,
  Edit,
  type EditorProps,
  editorViews,
  type EditProps,
  inline,
  popout,
  Prop,
  type PropProps,
  renderView,
  TimeVal,
  UrlVal,
  views,
} from './editors.ts'
export { canEdit, formatProp } from './read.ts'
export { write } from './write.ts'
export { Overlay, place, placeAt, tips, usePlaceAt } from './overlay.ts'
export { drop, focused, peek, save, useDraft } from './drafts.ts'
export { type Find, pickLine, useHits } from './hits.ts'
export { label } from './suggest.ts'
