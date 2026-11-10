/** The rows the studio's worker answers with, as its page reads them. */

type Row = { entity: { eid: string } }

/** The composed print document PrintBound answers a preparation with. */
export type Edition = {
  pages: { blob: string; role: string; number: number }[]
  interior: { blob: string }
  cover: { blob: string }
}

/** What a destination costs, and until when. */
export type Quote = {
  preview?: boolean
  currency: string
  /** in the currency's hundredths */
  total: number
  shipping: { name: string }
  expires: string
}

/** A print order, as far as it has come. */
export type Receipt = {
  preview?: boolean
  status: string
  checkout?: string
  tracking?: string[]
}

/** A book on the shelf: its idea, its story, and where its print stands. */
export type Book = Row & {
  doc: { title: string; body: string }
  coloring_book: {
    prompt: string
    mode: string
    age: string
    style: string
    character: string
    personalization: string
    dedication: string
  }
  page_drawing?: unknown
  page_failed?: { message: string }
  print_review?: { document?: Edition }
  print_quote?: { quote?: Quote }
  print_receipt?: { receipt?: Receipt }
  gallery_consent?: unknown
}

/** One page of a book: the scene to draw, and its artwork once drawn. */
export type Leaf = Row & {
  coloring_page: {
    position: number
    prompt: string
    caption: string
    activity?: string
  }
  artwork?: { blob: string; mime: string }
  page_drawing?: unknown
  page_failed?: { message: string }
}

/** A finished page somewhere on the shelf, offered for gathering. */
export type Offered = { title: string; page: Leaf }

/** What the studio is set up with. */
export type Settings = {
  /** fixtures stand in for models, payments and print orders */
  preview: boolean
  /** the print service's name */
  printer: string
  styles: (Row & { doc: { title: string } })[]
}
