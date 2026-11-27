/**
 * What a page opens over itself at a phone's width: a side menu, a panel that
 * takes the screen, a sheet. It slides in from its edge as it opens and back
 * out as it closes; `Layer-left` and `Layer-right` come from those sides, a
 * plain one up from the foot. The page decides where it lies and when it is
 * open: the address's target (`:target`, or a target inside it), a dialog's
 * `open` or a popover's. Wider than a phone it stands as the page puts it.
 * A side layer's edge toward the page casts a soft shadow; nothing dims the
 * page behind it.
 *
 * `Layer-under` turns a left layer's motion around: it stands still under the
 * page, and the page, a `Layer.Cover` after it, slides right by
 * `--layer-width` to uncover it and back over it to close it. The page lays
 * the layer that wide under itself; a `Layer.Shut` in the cover, a link to
 * close it, takes a press on what still shows of the page.
 *
 * Another part is drawn as one with `layer`: `h(SideNav.Edge, { as: Left })`,
 * where `let Left = layer('nav', 'left')`, renders
 * `<nav class="Layer Layer-left SideNav_Edge">`.
 *
 * @module
 */
import type { Sheet } from '@yaks/tui/theme'
import { createElement as h } from 'react'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A layer over the page, and what covers one under it. */
export let Layer: Part & Record<'Cover' | 'Shut', Part> = block(
  'div',
  'Layer',
  { Cover: 'div', Shut: 'a' },
)

/** How a layer moves: from the left or right (else up from the foot), and
 * whether it stands under the page. */
export type Way = 'left' | 'right' | 'under'

/** A part that is a layer, `ways` it moves, in `tag` unless it is given
 * `as`. Make one where a module loads, so each render draws the same
 * component. */
export let layer = (tag: string, ...ways: Way[]): Part =>
({
  as,
  ...props
}) => h(Layer, { ...props, as: as ?? tag, mod: ways })

/** What it is, in a line. */
export let description =
  'A side menu, panel or sheet over the page, sliding in from its edge.'

/** A terminal lays the page out whole: a layer stays in the flow. */
export let sheet = (_c: Colors): Sheet => ({})

/** One from each edge, and a menu revealed by sliding its page aside. */
export let specimens = (): Specimen[] => [
  ['Layer', h(Layer, {}, 'up from the foot')],
  ['Layer-left', h(Layer, { mod: 'left' }, 'from the left')],
  ['Layer-right', h(Layer, { mod: 'right' }, 'from the right')],
  [
    'Layer-under, Cover, Shut',
    h(
      'div',
      {
        id: 'layer-example',
        style: {
          position: 'relative',
          overflow: 'clip',
          '--layer-width': '6rem',
        },
      },
      h(Layer, {
        id: 'layer-example-menu',
        mod: ['left', 'under'],
        style: { position: 'absolute', inset: '0 auto 0 0' },
      }, 'Menu'),
      h(
        Layer.Cover,
        { style: { position: 'relative', background: 'var(--bg)' } },
        h('a', { href: '#layer-example-menu' }, 'Open menu'),
        h(Layer.Shut, { href: '#layer-example', 'aria-label': 'Close menu' }),
      ),
    ),
  ],
]
