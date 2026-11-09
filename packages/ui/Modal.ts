/** A dialog over the page, holding a card and a link back to what opened it. */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import { Card } from './Card.ts'
import { Button } from './Button.ts'
import type { Colors, Specimen } from './theme.ts'

/** A dialog's frame, its card, and the backdrop that closes it. */
export let Modal: Part & Record<'Body' | 'Backdrop', Part> = block(
  'dialog',
  'Modal',
  { Body: Card, Backdrop: 'a' },
)

export let description = 'A dialog holding one card above the page.'

export let sheet = (_c: Colors): Sheet => ({
  Modal: { col: true, gap: true },
  Modal_Backdrop: { hidden: true },
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
      h('p', null, 'Forecasts for your apps, connected with your own API key.'),
    ),
  ),
]]
