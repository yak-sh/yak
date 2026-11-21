/** A dialog over the page, holding a card and a link back to what opened it. */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import { Card } from './Card.ts'
import { Button } from './Button.ts'
import type { Colors, Specimen } from './theme.ts'

/** A dialog's frame, its card, and the backdrop that closes it. Under the
 * card's head, its `Main` pane holds what the dialog says, and `Actions`, a
 * small card floated at the pane's top right, what acts on all of it: the
 * head keeps only the title and what closes it. On a phone the actions run
 * across the top of the pane instead.
 *
 * A page with no script of its own opens one as a popover: the frame given
 * `as: 'div'` and `popover`, a button naming it in `popovertarget` opens it,
 * and its backdrop and close are buttons naming it with
 * `popovertargetaction: 'hide'`. Escape closes it as well. */
export let Modal:
  & Part
  & Record<'Body' | 'Backdrop' | 'Main' | 'Actions', Part> = block(
    'dialog',
    'Modal',
    { Body: Card, Backdrop: 'a', Main: 'div', Actions: 'aside' },
  )

export let description = 'A dialog holding one card above the page.'

export let sheet = (_c: Colors): Sheet => ({
  Modal: { col: true, gap: true },
  Modal_Backdrop: { hidden: true },
  Modal_Main: { col: true, gap: true },
  Modal_Actions: { row: true, spaced: true },
})

export let specimens = (): Specimen[] => [[
  'Modal, Body, Backdrop',
  h(
    Modal,
    {
      open: true,
      style: 'position: relative; height: auto',
      'aria-label': 'Service details',
    },
    h(Modal.Backdrop, {
      href: '#',
      'aria-label': 'Close details',
      tabIndex: -1,
      style: 'position: absolute',
    }),
    h(
      Modal.Body,
      null,
      h(
        Card.Head,
        null,
        h(Card.Title, null, 'Weather API'),
        h(Card.Actions, null, h(Button, { href: '#' }, 'Close')),
      ),
      h(
        Modal.Main,
        null,
        h(
          Modal.Actions,
          { 'aria-label': 'Actions' },
          h(Button, { href: '#' }, 'Disconnect'),
          h('a', { href: '#' }, 'Service homepage'),
        ),
        h(
          'p',
          null,
          'Forecasts for your apps, connected with your own API key.',
        ),
      ),
    ),
  ),
]]
