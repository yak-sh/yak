/**
 * What a page opens over itself at a phone's width: a side menu, a panel that
 * takes the screen, a sheet. It slides in from its edge as it opens and back
 * out as it closes; `Layer-left` and `Layer-right` come from those sides, a
 * plain one up from the foot. The page decides where it lies and when it is
 * open: the address's target (`:target`, or a target inside it), a dialog's
 * `open` or a popover's. Wider than a phone it stands as the page puts it.
 *
 * Another part is drawn as one with `layer`: `h(SideNav.Edge, { as: Left })`,
 * where `let Left = layer('nav', 'left')`, renders
 * `<nav class="Layer Layer-left SideNav_Edge">`.
 *
 * @module
 */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A layer over the page. */
export let Layer: Part = el('div', 'Layer')

/** A part that is a layer from `edge`, in `tag` unless it is given `as`. Make
 * one where a module loads, so each render draws the same component. */
export let layer = (tag: string, edge?: 'left' | 'right'): Part =>
({
  as,
  ...props
}) => h(Layer, { ...props, as: as ?? tag, mod: edge })

/** What it is, in a line. */
export let description =
  'A side menu, panel or sheet over the page, sliding in from its edge.'

/** A terminal lays the page out whole: a layer stays in the flow. */
export let sheet = (_c: Colors): Sheet => ({})

/** One from each edge, shown in place. */
export let specimens = (): Specimen[] =>
  [undefined, 'left', 'right'].map((edge) => [
    edge ? `Layer-${edge}` : 'Layer',
    h(Layer, { mod: edge }, edge ? `from the ${edge}` : 'up from the foot'),
  ])
