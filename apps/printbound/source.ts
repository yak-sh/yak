import { type Bundle, sha256 } from '@yaks/graph'
import {
  allowed,
  guard,
  identifier,
  principal,
  Refusal,
  type Store,
  type Who,
} from './store.ts'

export type Source = {
  owner?: string
  via?: string
  author: string
  markdown: string
  dedication: string
}
export type Document = {
  id: string
  revision: string
  pages: { number: number; role: string; blob: string; hash: string }[]
  interior: { blob: string }
  cover: { blob: string }
}
export type Quote = {
  id: string
  document: string
  expires: string
  currency: string
  total: number
  seller: string
  shipping: { id: string; name: string; cents: number }
}
export type Receipt = {
  id: string
  document?: string
  seller: string
  status: string
  tracking?: string[]
  checkout?: string
  historical?: boolean
}
export type Book = Bundle & {
  doc: { title: string }
  book_source: Source
  book_prepared?: { source: string; document: Document }
  book_quote?: { quote: Quote }
  book_receipt?: { receipt: Receipt }
}
export type Service = (
  name: 'prepare' | 'quote' | 'purchase' | 'order_status' | 'cancel',
  args: Record<string, unknown>,
  caller: Who,
) => Promise<unknown>
export let revision = (book: Book) =>
  sha256(
    JSON.stringify([
      book.doc.title,
      book.book_source.author,
      book.book_source.markdown,
      book.book_source.dedication,
    ]),
  )
export let source = (value: Record<string, unknown>) => ({
  title: String(value.title ?? 'Untitled book').slice(0, 120) ||
    'Untitled book',
  author: String(value.author ?? '').slice(0, 120),
  markdown: String(value.markdown ?? ''),
  dedication: String(value.dedication ?? '').slice(0, 2000),
})
export let studio = (db: Store, service: Service) => {
  let owned = async (id: unknown, caller: Who): Promise<Book> => {
    let [row] = await db.query(
      `.entity.eid=${
        identifier(id)
      }&.book_source&?doc&?book_prepared&?book_quote&?book_receipt`,
    ) as Book[]
    if (!row || !allowed(row.book_source, caller)) {
      throw new Refusal('That saved book is not available.', 403)
    }
    return row
  }
  let write = async (book: Book, changes: Bundle) => {
    await db.apply([{
      ...changes,
      entity: book.entity,
      $was: guard(book, ['doc', 'book_source']),
    }])
    return { ...book, ...changes }
  }
  let prepared = (book: Book) => {
    if (!book.book_prepared || book.book_prepared.source !== revision(book)) {
      throw new Refusal(
        'Prepare and review this edition before asking for its price.',
      )
    }
    return book.book_prepared.document
  }
  return {
    owned,
    async shelf(caller: Who) {
      principal(caller)
      let filters = [
        caller.person ? `.book_source.owner=${identifier(caller.person)}` : '',
        caller.via
          ? `.book_source.via=${identifier(caller.via)}&!book_source.owner`
          : '',
      ].filter(Boolean)
      let rows = (await Promise.all(
        filters.map((filter) =>
          db.query(
            `${filter}&?doc&?book_source&?book_prepared&?book_quote&?book_receipt`,
          )
        ),
      )).flat() as Book[]
      return rows.filter((row) => allowed(row.book_source, caller))
    },
    async save(value: Record<string, unknown>, caller: Who) {
      let input = source(value)
      if (!input.title.trim()) throw new Refusal('Give your book a title.')
      let row = value.id ? await owned(value.id, caller) : null
      let entity = row?.entity ?? { eid: crypto.randomUUID() }
      let changes = {
        entity,
        doc: { title: input.title },
        book_source: {
          ...principal(caller),
          ...(row?.book_source.via ? { via: row.book_source.via } : {}),
          author: input.author,
          markdown: input.markdown,
          dedication: input.dedication,
        },
        book_prepared: null,
        book_quote: null,
      }
      await db.apply([{
        ...changes,
        ...(row ? { $was: guard(row, ['doc', 'book_source']) } : {}),
      }])
      return await owned(entity.eid, caller)
    },
    async prepare(id: unknown, caller: Who) {
      let book = await owned(id, caller)
      if (!book.book_source.markdown.trim()) {
        throw new Refusal(
          'Paste your conversation or Markdown before preparing the book.',
        )
      }
      let document = await service('prepare', {
        title: book.doc.title,
        ...book.book_source,
      }, caller) as Document
      if (!document?.revision || !document.pages?.length) {
        throw new Error('Preparation returned no reviewable document.')
      }
      await write(book, {
        entity: book.entity,
        book_prepared: { source: revision(book), document },
        book_quote: null,
      })
      return document
    },
    async quote(
      id: unknown,
      destination: Record<string, unknown>,
      caller: Who,
    ) {
      let book = await owned(id, caller), document = prepared(book)
      let quote = await service('quote', {
        ...destination,
        document: document.id,
      }, caller) as Quote
      await write(book, { entity: book.entity, book_quote: { quote } })
      return quote
    },
    async purchase(id: unknown, caller: Who) {
      let book = await owned(id, caller),
        document = prepared(book),
        quote = book.book_quote?.quote
      if (!quote || quote.document !== document.id) {
        throw new Refusal('Request a quote for the document you reviewed.')
      }
      if (!(Date.parse(quote.expires) > Date.now())) {
        throw new Refusal('This quote expired. Request a fresh quote.')
      }
      let receipt = await service('purchase', {
        quote: quote.id,
        document: document.id,
      }, caller) as Receipt
      await write(book, { entity: book.entity, book_receipt: { receipt } })
      return receipt
    },
    async progress(id: unknown, caller: Who) {
      let book = await owned(id, caller)
      if (!book.book_receipt) return null
      if (book.book_receipt.receipt.historical) return book.book_receipt.receipt
      let receipt = await service('order_status', {
        order: book.book_receipt.receipt.id,
      }, caller) as Receipt
      await db.apply([{ entity: book.entity, book_receipt: { receipt } }])
      return receipt
    },
    async cancel(id: unknown, caller: Who) {
      let book = await owned(id, caller)
      if (!book.book_receipt) throw new Refusal('This book has no print order.')
      if (book.book_receipt.receipt.historical) {
        throw new Refusal(
          'Contact PrintBound about changes to this earlier order.',
        )
      }
      return await service(
        'cancel',
        { order: book.book_receipt.receipt.id },
        caller,
      )
    },
  }
}
