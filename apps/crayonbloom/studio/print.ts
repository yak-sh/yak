/** Printing a book with PrintBound: the composed document to review, where
 * a copy goes, and what PrintBound quoted and answered for it. */
import { type ComponentChildren, h } from 'preact'
import { Button, Card, Cards, Empty, Form } from '@yaks/ui/parts'
import { Desk } from '../look/parts/Desk.ts'
import { Sheet } from '../look/parts/Sheet.ts'
import { Tray } from '../look/parts/Tray.ts'
import type { Place } from '../pages/chrome.ts'
import { filed, Labeled, options, press } from './kit.ts'
import type { Book, Edition, Quote, Receipt } from './rows.ts'
import { APPROVE, CHANGE } from '../approve.ts'

type Told = [title: string, held: ComponentChildren]

let Review = (
  { edition, file }: { edition: Edition; file: (blob: string) => string },
) =>
  h(
    Card,
    {},
    h(
      Card.Head,
      {},
      h(Card.Title, {}, 'Review your complete print document'),
    ),
    h(
      Card.Sub,
      {},
      'PrintBound composed these pages. They are the same files attached to checkout, including the cover and blank leaves.',
    ),
    h(
      Cards,
      {},
      edition.pages.map((page) =>
        h(
          Sheet,
          {},
          h(
            Sheet.Art,
            {},
            h(Sheet.Line, {
              src: file(page.blob),
              alt: `${page.role} ${page.number}`,
              loading: 'lazy',
            }),
          ),
          h(Sheet.Caption, {}, `${page.role} · page ${page.number}`),
        )
      ),
    ),
    h(
      Desk.Row,
      {},
      [
        [edition.interior.blob, 'Open interior PDF'],
        [edition.cover.blob, 'Open cover PDF'],
      ].map(([blob, said]) =>
        h(Button, { href: file(blob), target: '_blank', rel: 'noopener' }, said)
      ),
    ),
  )

let SHIPPING: [string, string][] = [
  ['MAIL', 'Standard'],
  ['GROUND', 'Ground'],
  ['EXPEDITED', 'Expedited'],
]

let Destination = () =>
  h(
    Card,
    {},
    h(Card.Head, {}, h(Card.Title, {}, 'Print a copy with PrintBound')),
    h(
      Card.Sub,
      {},
      'PrintBound is the seller. You pay PrintBound once; CrayonBloom adds no second print charge.',
    ),
    h(
      Form,
      { 'data-destination': true },
      ([
        ['name', 'Recipient name', 'e.g. Maya Chen'],
        ['street1', 'Street address', 'e.g. 123 Oak Street'],
        ['street2', 'Apartment or unit', 'e.g. Apt 2B', '', true],
        ['city', 'City', 'e.g. Kalamazoo'],
        ['state_code', 'State or region', 'e.g. MI'],
        ['postcode', 'Postal code', 'e.g. 49007'],
        ['country_code', 'Country code', 'e.g. US', 'US'],
        ['phone_number', 'Delivery phone', '269-555-0142'],
      ] as const).map(([name, title, placeholder, defaultValue, optional]) =>
        h(Labeled, {
          id: 'to-' + name,
          title,
          name,
          placeholder,
          defaultValue,
          optional,
        })
      ),
      h(Labeled, {
        id: 'to-quantity',
        title: 'Copies',
        name: 'quantity',
        placeholder: 'e.g. 1',
        type: 'number',
        min: 1,
        defaultValue: 1,
      }),
      h(
        Labeled,
        {
          id: 'to-shipping',
          title: 'Shipping',
          name: 'shipping',
          choose: true,
        },
        options(SHIPPING, 'MAIL'),
      ),
      h(
        Form.Actions,
        {},
        h(Button, { type: 'submit' }, 'Get destination quote'),
      ),
    ),
  )

let money = (quote: Quote) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: quote.currency,
  }).format(quote.total / 100)

/** What PrintBound quoted: its heading, then what it holds. */
let quoted = (quote: Quote): Told => [
  quote.preview ? 'Simulated PrintBound quote' : 'Your PrintBound quote',
  [
    h(
      'p',
      {},
      'Seller: PrintBound',
      h('br', {}),
      `Total including delivery and tax: ${money(quote)}`,
      h('br', {}),
      `${quote.shipping.name} · Valid until ${
        new Date(quote.expires).toLocaleString()
      }`,
    ),
    h(
      Desk.Row,
      {},
      press(
        'purchase',
        quote.preview
          ? 'Simulate print purchase'
          : 'Continue to PrintBound checkout',
        { mod: 'go' },
      ),
    ),
  ],
]

/** How an order stands: its heading, then what it holds. */
let ordered = (receipt: Receipt): Told => [
  receipt.preview ? 'Simulated print receipt' : 'Your print receipt',
  [
    h(
      'p',
      {},
      'Seller: PrintBound',
      h('br', {}),
      `${
        receipt.preview ? 'Simulated progress' : 'Provider-confirmed progress'
      }: ${receipt.status}`,
    ),
    (receipt.checkout || !!receipt.tracking?.length) && h(
      Desk.Row,
      {},
      receipt.checkout &&
        h(
          Button,
          { mod: 'go', href: receipt.checkout },
          'Open secure checkout',
        ),
      (receipt.tracking ?? []).map((href) =>
        h(Button, { mod: 'quiet', href }, 'Track shipment')
      ),
    ),
    h(
      Desk.Row,
      {},
      press('progress', 'Refresh progress'),
      press('cancel', 'Request cancellation', { mod: 'danger' }),
    ),
  ],
]

/** What PrintBound has said of a book so far, the first under the card's
 * head and the rest ruled off under it; before a quote, where one will be. */
let Answers = ({ book }: { book: Book }) => {
  let quote = book.print_quote?.quote, receipt = book.print_receipt?.receipt
  let [first, ...rest] = [quote && quoted(quote), receipt && ordered(receipt)]
    .filter((told): told is Told => !!told)
  return first
    ? h(
      Card,
      {},
      h(Card.Head, {}, h(Card.Title, {}, first[0])),
      first[1],
      rest.map(([title, held]) =>
        h(Tray, { mod: 'ruled' }, h(Tray.Title, {}, title), held)
      ),
    )
    : h(
      Empty,
      {},
      h(Empty.Title, {}, 'No quote yet'),
      h(
        'p',
        {},
        'Say where a copy goes and PrintBound’s total shows here, delivery and tax included.',
      ),
    )
}

/** A prepared book's print: its document to review, then the destination
 * beside what PrintBound quoted and answered. Nothing before a book is
 * prepared. */
export let Print = ({ place, book }: { place: Place; book: Book | null }) => {
  let edition = book?.print_review?.document
  if (!book || !edition) return null
  let approved = book.approval?.choice === APPROVE
  return [
    h(Review, { edition, file: filed(place, book) }),
    h(Approve, { book }),
    approved && h(Desk.Pair, {}, h(Destination, {}), h(Answers, { book })),
  ]
}

/** The workflow's person step: the owner approves the document they just
 * reviewed, or goes back to change pages. Asked in their Updates too. */
let Approve = ({ book }: { book: Book }) => {
  let choice = book.approval?.choice
  return h(
    Card,
    {},
    h(
      Card.Head,
      {},
      h(
        Card.Title,
        {},
        choice === APPROVE
          ? 'Approved for print'
          : 'Print it as the preview shows it?',
      ),
    ),
    !book.approval
      ? h(
        Card.Sub,
        {},
        'Asking you to approve this document… it shows here and in your Updates in a moment.',
      )
      : choice === CHANGE
      ? h(
        Card.Sub,
        {},
        'Edit, redraw or reorder pages above, then prepare the book again to approve the new document.',
      )
      : choice !== APPROVE &&
        h(
          Desk.Row,
          {},
          press('approve', APPROVE, { mod: 'go', 'data-choice': APPROVE }),
          press('approve', CHANGE, { mod: 'quiet', 'data-choice': CHANGE }),
        ),
  )
}
