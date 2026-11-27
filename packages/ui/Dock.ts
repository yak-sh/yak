/**
 * What stays one press away over every page, pinned to the window's foot at
 * its right: a `Launcher` saying what is in it at a glance (`Faces`, a few
 * small initials, and a `Badge`), the `Panel` it opens over the page without
 * leaving it, and a `Toast`, a quiet word beside the launcher about what just
 * came. The panel is a popover: the launcher names it in `popovertarget`,
 * and it stays open as the page under it changes. Its `Head` holds what it is
 * and what closes it, its `Body` scrolls, and its `Foot` holds what is typed.
 *
 * Wider than a phone the panel floats over the page's corner above the
 * launcher, a card wide. At a phone's width it takes the screen, a `Layer`
 * sliding up from the foot as it opens, and `Launcher-bar` is the launcher
 * as a page's bar wears it, where a phone keeps it in sight instead; `Here`
 * is a dot on it saying someone is in.
 *
 * @module
 */
import type { Sheet } from '@yaks/tui/theme'
import { createElement as h } from 'react'
import { block, type Part } from './el.ts'
import { Badge } from './Badge.ts'
import { Button } from './Button.ts'
import { Dot } from './Dot.ts'
import { Identity } from './Identity.ts'
import { layer } from './Layer.ts'
import type { Colors, Specimen } from './theme.ts'

/** The dock, its launcher and the panel it opens. */
export let Dock:
  & Part
  & Record<
    | 'Launcher'
    | 'Faces'
    | 'Face'
    | 'Word'
    | 'Panel'
    | 'Head'
    | 'Title'
    | 'Body'
    | 'Foot'
    | 'Toast'
    | 'Here',
    Part
  > = block('div', 'Dock', {
    Launcher: Button,
    Faces: 'span',
    Face: Identity.Avatar,
    Word: 'span',
    Panel: layer('section'),
    Head: 'header',
    Title: 'div',
    Body: 'div',
    Foot: 'footer',
    Toast: 'button',
    Here: 'span',
  })

/** What it is, in a line. */
export let description =
  'A launcher pinned to the corner, and the panel it opens over any page.'

/** A terminal lays it out in the flow: the launcher a row, the panel a
 * column under it. */
export let sheet = (c: Colors): Sheet => ({
  Dock: { col: true },
  Dock_Launcher: { row: true, spaced: true },
  Dock_Faces: { row: true },
  Dock_Panel: { col: true, gap: true },
  Dock_Head: { row: true, spaced: true, bold: true },
  Dock_Body: { col: true, gap: true },
  Dock_Toast: { fg: c.muted },
})

/** The dock, its launchers, and the three presence states. */
export let specimens = (): Specimen[] => [[
  'Dock, Launcher, Faces, Panel',
  h(
    Dock,
    { style: { position: 'relative', inset: 'auto' } },
    h(
      Dock.Panel,
      { style: { position: 'relative', inset: 'auto', display: 'grid' } },
      h(
        Dock.Head,
        null,
        h(Dock.Title, null, 'Friends'),
        h(Button, { mod: 'quiet' }, 'Close'),
      ),
      h(Dock.Body, null, 'Ann, online now'),
      h(Dock.Foot, null, 'Add a friend'),
    ),
    h(
      Dock.Launcher,
      null,
      h(
        Dock.Faces,
        null,
        h(Dock.Face, { person: 'ada' }, 'A'),
        h(Dock.Face, { person: 'bo' }, 'B'),
      ),
      h(Dock.Word, null, 'Friends'),
      h(Badge, null, '2'),
    ),
    h(Dock.Toast, null, h('b', null, 'Ann'), ': Lunch?'),
  ),
], [
  'Dock, Launcher-bar',
  h(
    Dock.Launcher,
    { mod: 'bar' },
    'Friends',
    h(Dot, { mod: 'positive', className: 'Dock_Here Dock_Presence' }),
    h(Badge, null, '2'),
  ),
], [
  'Dock, Launcher-bar, Presence away',
  h(
    Dock.Launcher,
    { mod: 'bar' },
    'Friends',
    h(Dot, { mod: 'caution', className: 'Dock_Here Dock_Presence' }),
  ),
], [
  'Friend presence',
  h(
    'div',
    { style: { display: 'flex', flexWrap: 'wrap', gap: '1rem' } },
    [['Active', 'positive'], ['Away', 'caution'], ['Offline', 'offline']].map(
      ([label, mod]) =>
        h(
          'span',
          {
            key: mod,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '.4rem',
            },
          },
          h(Dot, { mod, className: 'Dock_Presence', 'aria-hidden': 'true' }),
          label,
        ),
    ),
  ),
]]
