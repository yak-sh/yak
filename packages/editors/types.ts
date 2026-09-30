/**
 * An editor, as a registry holds it: a @yaks/preact component renderer
 * selected by the property it edits (`.prop.type=enum`), with the face it
 * gives a value at rest.
 *
 * @module
 */

import type { JSX } from 'preact'
import type { ComponentRenderer } from '@yaks/preact'

/** One editor registration, drawn with `E`, whatever shape of an entity the
 * page's registry hands its views (a bundle, unless it says). `show` paints
 * a value's face from its text as `formatProp` (./read.ts) gives it. */
export type Editor<E = unknown> = ComponentRenderer<E> & {
  show?: (face: string | null) => JSX.Element | null
}
