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
        ['name', 'Recipient name'],
        ['street1', 'Street address'],
        ['street2', 'Apartment or unit', '', true],
        ['city', 'City'],
        ['state_code', 'State or region'],
        ['postcode', 'Postal code'],
        ['country_code', 'Country code', 'US'],
        ['phone_number', 'Delivery phone'],
      ] as [string, string, string?, boolean?][]).map((
        [name, title, defaultValue, optional],
      ) =>
        h(Labeled, { id: 'to-' + name, title, name, defaultValue, optional })
      ),
      h(Labeled, {
        id: 'to-quantity',
        title: 'Copies',
        name: 'quantity',
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
  return book && edition
    ? [
      h(Review, { edition, file: filed(place, book) }),
      h(Desk.Pair, {}, h(Destination, {}), h(Answers, { book })),
    ]
    : null
}
