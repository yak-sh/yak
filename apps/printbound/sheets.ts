/** What the studio's desk draws: the shelf of saved books, and one book's
 * sheets, its words beside its proof and where it goes beside what that
 * costs. Each is paint over the rows the desk was answered with; what a
 * press or a typed word does is the desk's (`Does`, ./desk.ts).
 *
 * @module
 */

import { type ComponentChildren, type FunctionComponent, h } from 'preact'
import {
  Body,
  Button,
  Card,
  Cards,
  Empty,
  Field,
  Form,
  Notice,
  type Part,
} from '@yaks/ui/parts'
import { Desk, Proof, Slip } from './site/parts.ts'

type File = { blob: string }
type Leaf = File & { role: string; number: number }
type Quoted = {
  preview?: boolean
  currency: string
  total: number
  shipping?: string | { name: string }
  expires: string
}
type Ordered = {
  preview?: boolean
  status: string
  checkout?: string
  tracking?: string[]
}

/** A saved book, as the studio's door answers it. */
export type Row = {
  entity: { eid: string }
  doc: { title: string }
  book_source?: { author?: string; markdown?: string; dedication?: string }
  book_prepared?: { document?: { pages: Leaf[]; interior: File; cover: File } }
  book_quote?: { quote?: Quoted }
  book_receipt?: { receipt?: Ordered }
}

type Heard = (event: Event) => void

/** What the desk does when a sheet is typed in, sent or pressed. */
export type Does = Record<
  'typed' | 'keep' | 'prepare' | 'quote' | 'purchase' | 'progress' | 'cancel',
  Heard
>

let prose = (text: string) => h(Body, {}, h(Body.Paragraph, {}, text))
let head = (title: string) => h(Card.Head, {}, h(Card.Title, {}, title))
let optional = (title: string) => [
  title + ' ',
  h(Form.Optional, {}, '(optional)'),
]

// One field of a form: its label over its control, named as the door reads it.
let field = (
  form: string,
  name: string,
  title: ComponentChildren,
  props: Record<string, unknown> = {},
  Control: Part | typeof Field = Field,
) =>
  h(
    Form.Field,
    {},
    h(Form.Label, { for: `${form}-${name}` }, title),
    h(Control, { id: `${form}-${name}`, name, ...props }),
  )

let file = (id: string, blob: string) =>
  './studio/file?id=' + encodeURIComponent(id) + '&blob=' +
  encodeURIComponent(blob)

let money = (q: Quoted) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: q.currency })
    .format(q.total / 100)

let line = (name: string, value: ComponentChildren, mod?: string) =>
  h(Slip.Line, {}, h(Slip.Name, {}, name), h(Slip.Value, { mod }, value))

let LEDE =
  'Save the words you want to keep. Review a finished book before paying for print.'
let begin = () => h(Button, { href: '#new', mod: 'go' }, 'Start a book')
let stands = (row: Row) =>
  row.book_receipt
    ? 'Print order saved'
    : row.book_prepared
    ? 'Ready to review'
    : 'Saved draft'

/** The shelf: every saved book, and where a new one starts. */
export let Shelf: FunctionComponent<{ rows: Row[] }> = ({ rows }) => [
  h(
    Desk.Head,
    {},
    h(Desk.Title, {}, 'Your books'),
    rows.length ? [prose(LEDE), begin()] : null,
  ),
  rows.length
    ? h(
      Cards,
      {},
      rows.map((row) =>
        h(
          Card,
          { key: row.entity.eid, href: '#book/' + row.entity.eid },
          h(Card.Title, {}, row.doc.title),
          h(Card.Sub, {}, stands(row)),
        )
      ),
    )
    : h(Empty, {}, h('p', {}, LEDE), begin()),
]

// The book's words, saved as they are typed.
let Source = ({ book, on }: { book: Row | null; on: Does }) => {
  let s = book?.book_source ?? {}
  return h(
    Card,
    {},
    h(
      Form,
      { 'data-source': '', onInput: on.typed, onSubmit: on.keep },
      field('book', 'title', 'Book title', { value: book?.doc.title }),
      field('book', 'author', optional('Author'), { value: s.author }),
      field('book', 'markdown', 'Your conversation or Markdown', {
        lines: true,
        value: s.markdown,
      }, Desk.Words),
      field('book', 'dedication', optional('Dedication'), {
        value: s.dedication,
      }),
      h(
        Form.Hint,
        {},
        'Your draft is saved as you edit. Headings, paragraphs, lists and emphasis become the book’s typography.',
      ),
      h(
        Form.Actions,
        {},
        h(Button, { type: 'submit' }, 'Save draft'),
        h(
          Button,
          { type: 'button', mod: 'go', onClick: on.prepare },
          'Prepare book',
        ),
      ),
    ),
  )
}

let pdf = (href: string, words: string) =>
  h(Button, { href, target: '_blank', rel: 'noopener' }, words)

// The composed pages to check, once the book is prepared.
let Review = ({ book }: { book: Row | null }) => {
  let doc = book?.book_prepared?.document, id = book?.entity.eid ?? ''
  if (!doc) {
    return h(
      Card,
      {},
      head('Your final document'),
      prose(
        'Save your text, then prepare your book. You can review the complete document before requesting a destination quote.',
      ),
    )
  }
  return h(
    Card,
    {},
    head('Review your print document'),
    prose(
      'These are the composed pages PrintBound will print. Check every page before checkout.',
    ),
    h(
      Proof,
      {},
      h(
        Proof.Pages,
        {},
        doc.pages.map((page) =>
          h(
            Proof.Page,
            {},
            h(Proof.Image, {
              src: file(id, page.blob),
              alt: `${page.role} ${page.number}`,
            }),
            h(Proof.Caption, {}, `${page.role} · page ${page.number}`),
          )
        ),
      ),
      h(
        Proof.Files,
        {},
        pdf(file(id, doc.interior.blob), 'Open interior PDF'),
        pdf(file(id, doc.cover.blob), 'Open cover PDF'),
      ),
    ),
  )
}

let SHIPPING = { MAIL: 'Standard', GROUND: 'Ground', EXPEDITED: 'Expedited' }

// Where the book is sent, and how many.
let Destination = ({ on }: { on: Does }) =>
  h(
    Card,
    {},
    head('Where should it go?'),
    h(
      Form,
      { 'data-destination': '', onSubmit: on.quote },
      field('to', 'name', 'Recipient name'),
      field('to', 'street1', 'Street address'),
      field('to', 'street2', optional('Apartment or unit')),
      field('to', 'city', 'City'),
      field('to', 'state_code', 'State or region'),
      field('to', 'postcode', 'Postal code'),
      field('to', 'country_code', 'Country code', { value: 'US' }),
      field('to', 'phone_number', 'Delivery phone'),
      field('to', 'quantity', 'Copies', {
        type: 'number',
        min: 1,
        max: 100,
        value: 1,
      }),
      field('to', 'shipping', 'Shipping', {
        choose: true,
        children: Object.entries(SHIPPING).map(([value, words]) =>
          h('option', { value }, words)
        ),
      }),
      h(
        Form.Actions,
        {},
        h(Button, { type: 'submit', mod: 'go' }, 'Get destination quote'),
      ),
    ),
  )

// What printing and sending it comes to, and the press that buys it.
let Quote = ({ quote: q, on }: { quote: Quoted; on: Does }) =>
  h(
    Card,
    {},
    head(q.preview ? 'Simulated PrintBound quote' : 'Your PrintBound quote'),
    h(
      Slip,
      {},
      line('Seller', 'PrintBound'),
      line('Print, delivery and tax total', money(q), 'total'),
      line(
        'Shipping',
        typeof q.shipping == 'object' ? q.shipping.name : q.shipping,
      ),
      line('Valid until', new Date(q.expires).toLocaleString()),
    ),
    prose(
      'Payment is made to PrintBound once. Your selected document stays attached to this quote.',
    ),
    h(
      Card.Actions,
      {},
      h(
        Button,
        { type: 'button', mod: 'go', onClick: on.purchase },
        q.preview
          ? 'Simulate print purchase'
          : 'Continue to PrintBound checkout',
      ),
    ),
  )

// The order once bought: how it stands, and what can still be done about it.
let Receipt = ({ receipt: r, on }: { receipt: Ordered; on: Does }) =>
  h(
    Card,
    {},
    head(r.preview ? 'Simulated print order' : 'Your print order'),
    h(
      Slip,
      {},
      line('Seller', 'PrintBound'),
      line(
        r.preview ? 'Simulated progress' : 'Provider-confirmed progress',
        r.status,
      ),
    ),
    h(
      Card.Actions,
      {},
      (r.tracking ?? []).map((href) => h(Button, { href }, 'Track shipment')),
      h(Button, { type: 'button', onClick: on.progress }, 'Refresh progress'),
      h(
        Button,
        { type: 'button', mod: 'danger', onClick: on.cancel },
        'Request cancellation',
      ),
      r.checkout &&
        h(Button, { href: r.checkout, mod: 'go' }, 'Open secure checkout'),
    ),
  )

/** The line the desk says back, a refusal in the negative. The line is there
 * whether or not anything is said, so what comes to be said in it is heard. */
export let Said: FunctionComponent<{ text: string; bad: boolean }> = (
  { text, bad },
) =>
  h(
    Desk.Said,
    {},
    h(
      Notice,
      { role: 'status', 'aria-live': 'polite', mod: bad && 'negative' },
      text || null,
    ),
  )

/** A book on the desk: its words beside its proof, and, once it is prepared,
 * where it goes beside its quote and its order. */
export let Book: FunctionComponent<{ book: Row | null; on: Does }> = (
  { book, on },
) => {
  let quote = book?.book_quote?.quote, receipt = book?.book_receipt?.receipt
  return [
    h(
      Desk.Head,
      {},
      h(Desk.Back, { href: '#' }, '← Your shelf'),
      h(Desk.Title, {}, book ? book.doc.title : 'Make a book from your words'),
    ),
    h(Desk.Spread, {}, h(Source, { book, on }), h(Review, { book })),
    book?.book_prepared?.document && h(
      Desk.Spread,
      {},
      h(Destination, { on }),
      h(
        Desk.Column,
        {},
        quote && h(Quote, { quote, on }),
        receipt && h(Receipt, { receipt, on }),
      ),
    ),
  ]
}
