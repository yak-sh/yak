/**
 * @yaks/ux: UX components, between UI components (@yaks/ui: a look, no
 * behavior) and domain components (meaning: queries, server data). A UX
 * component prescribes behavior and holds no state of its own in memory: it
 * is controlled by a bundle and emits a bundle of the same shape, the way
 * `<input value onChange>` does, and an event bundle only when it has
 * something to say that is not a new value. Its own state is one component
 * named after it, in CamelCase, on an entity of its own in the page's graph
 * (./vocab.json), so its owner can read it and a remount finds it again.
 *
 * - `Edit`, `Edit.Text`, `Edit.Control`: a property's value changed where it
 *   stands, typed over in place, or its control alone (./Edit.ts, ./Text.ts).
 * - `Disclosure`: a summary opening optional content; `disclosureAt`,
 *   `isOpen`, `disclosed`, its page eid and bundles, pure (./Disclosure.ts).
 * - `Ux`, `useHost`, `Host`: what a page hands down, once per tree
 *   (./host.ts).
 * - `carry`, `carries`, `carried`: an entity carried by a drag from one
 *   place to another, whoever drew either (./carry.ts).
 * - `Order`: a list put in order by dragging its rows, taking a carried
 *   entity between two of them; `orderAt`, `landing`, `landed`, `among`,
 *   `placing`, its page eid, bundles and arithmetic, pure (./Order.ts).
 * - `useEdit`, `Editing`: an `Edit`'s state, read and changed by whoever
 *   owns it (./live.ts).
 * - `at`, `place`, `put`, `changed`, `refused`, `valueOf`: the bundles and
 *   names, pure (./state.ts).
 * - `editorViews`, `views`: the editors as registrations (the `/views`
 *   facet); `TimeVal`, `UrlVal`: faces.
 * - `pickLine`, `useHits`, `label`: a picker's candidates, asked of the
 *   graph.
 * - `canEdit`, `formatProp`, `reading`: what a value is, pure.
 *
 * @module
 */

export {
  type Bundle,
  type Drafts,
  type Float,
  type Front,
  type Host,
  useHost,
  useOwner,
  Ux,
} from './host.ts'
export {
  type ControlOwnProps,
  type ControlProps,
  Edit,
  type Editor,
  editorViews,
  type EditProps,
  TimeVal,
  UrlVal,
  views,
} from './Edit.ts'
export { Text, type TextProps } from './Text.ts'
export {
  disclosed,
  Disclosure,
  disclosureAt,
  type DisclosureProps,
  isOpen,
} from './Disclosure.ts'
export { CARRIED, carried, carries, carry } from './carry.ts'
export {
  among,
  landed,
  landing,
  Order,
  orderAt,
  type OrderProps,
  placing,
} from './Order.ts'
export { type Editing, useEdit } from './live.ts'
export {
  at,
  changed,
  place,
  put,
  refused,
  type Row,
  source,
  valueOf,
} from './state.ts'
export { emit, type OnChange, reading } from './emit.ts'
export { canEdit, formatProp, isBody, wellOf } from './read.ts'
export { type Find, pickLine, useHits } from './hits.ts'
export { label } from './suggest.ts'

export {
  defineKit,
  type Kit,
  kitDocs,
  type Piece,
  type Specimen,
} from './kit.ts'

export {
  completion,
  type Controller as CompletionController,
  type FieldProps,
} from './completion.ts'
