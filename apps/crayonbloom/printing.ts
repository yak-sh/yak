import { sha256 } from '@yaks/graph'
import { type Binding, guard, json, Refusal, type Store } from './db.ts'
import {
  type Book,
  complete,
  fingerprint,
  ordered,
  type Page,
} from './model.ts'
import type { Runtime } from './generation.ts'

export type Printer = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>
export let printer =
  (binding: Binding, service: string): Printer => async (name, args) => {
    if (!service) {
      throw new Refusal(
        'PrintBound has not been connected to this preview yet.',
      )
    }
    let answer = await binding.fetch('/service', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service, name, args }),
    })
    let result = await json<{ value: { answer: string } }>(answer)
    return JSON.parse(result.value.answer) as Record<string, unknown>
  }
export let edition = (book: Book, pages: Page[]) =>
  sha256(
    JSON.stringify([
      book.doc.title,
      book.coloring_book.dedication,
      ordered(pages).map((
        p,
      ) => [
        p.entity.eid,
        p.artwork?.hash,
        fingerprint(book, p),
        p.coloring_page.caption,
      ]),
    ]),
  )
export let printing = (
  db: Store,
  app: Binding,
  service: Printer,
  runtime: Runtime,
) => {
  let links = async (blobs: string[]) => {
    let answer = await json<{ links: { artifact: string; url: string }[] }>(
      await app.fetch('/pay/artifacts/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifacts: [...new Set(blobs)] }),
      }),
    )
    let indexed = new Map(
      answer.links.map((link) => [link.artifact, link.url]),
    )
    return (blob: string) => {
      let url = indexed.get(blob)
      if (!url) {
        throw new Error(
          'A selected artwork link was missing from the signed batch.',
        )
      }
      return url
    }
  }
  let reviewable = (document: Record<string, unknown>) => {
    if (document.error) throw new Refusal(String(document.error))
    if (
      !document.revision || !Array.isArray(document.pages) ||
      !document.pages.length || !document.interior || !document.cover
    ) {
      throw new Error('Preparation returned no reviewable document.')
    }
  }
  let prepare = async (book: Book, pages: Page[]) => {
    if (!complete(book, pages)) {
      throw new Refusal(
        'Finish drawing every selected page before preparing your print document.',
      )
    }
    let pending = book.print_preparation as
      | { source: string; document: string }
      | undefined
    let selected = ordered(pages),
      link = await links(selected.map((page) => page.artwork!.blob)),
      assets = []
    for (let page of selected) {
      assets.push({
        blob: link(page.artwork!.blob),
        caption: page.coloring_page.caption,
        kind: page.coloring_page.activity ? 'puzzle' : 'image',
      })
    }
    let document = await service('prepare', {
      ...(pending?.source === edition(book, pages)
        ? { document: pending.document }
        : {}),
      title: book.doc.title,
      dedication: book.coloring_book.dedication,
      pages: assets,
      front: link(selected[0].artwork!.blob),
      product: 'coloring',
      front_bleed: false,
    })
    if (document.error) throw new Refusal(String(document.error))
    if (document.pending) {
      await db.apply([{
        entity: book.entity,
        print_preparation: {
          source: edition(book, pages),
          document: document.id,
        },
        print_quote: null,
        $was: guard(book, ['doc', 'coloring_book']),
      }])
      return document
    }
    reviewable(document)
    await db.apply([{
      entity: book.entity,
      print_review: { document: { ...document, source: edition(book, pages) } },
      print_quote: null,
      $was: guard(book, ['doc', 'coloring_book']),
    }])
    return document
  }
  let document = (book: Book, pages: Page[]) => {
    if (!complete(book, pages)) {
      throw new Refusal(
        'Finish drawing the selected edition before requesting a print quote.',
      )
    }
    let doc = book.print_review?.document
    if (!doc || doc.source !== edition(book, pages)) {
      throw new Refusal(
        'Prepare and review this edition before asking for its price.',
      )
    }
    return doc
  }
  return {
    prepare,
    async preparation(book: Book, pages: Page[]) {
      if (!complete(book, pages)) {
        throw new Refusal(
          'Your selected pages changed. Finish drawing them before reviewing a print document.',
        )
      }
      let pending = book.print_preparation as {
        source: string
        document: string
      } | undefined
      if (!pending) return book.print_review?.document ?? null
      if (pending.source !== edition(book, pages)) {
        throw new Refusal(
          'Your selected pages changed. Prepare this edition again.',
        )
      }
      let doc = await service('document_status', {
        document: pending.document,
      })
      if (doc.pending) return doc
      reviewable(doc)
      await db.apply([{
        entity: book.entity,
        print_preparation: null,
        print_review: { document: { ...doc, source: pending.source } },
        print_quote: null,
        $was: guard(book, ['print_preparation', 'doc', 'coloring_book']),
      }])
      return doc
    },
    async quote(book: Book, pages: Page[], value: Record<string, unknown>) {
      let doc = document(book, pages),
        quote = await service('quote', {
          document: doc.id,
          quantity: value.quantity,
          address: value.address,
          shipping: value.shipping,
        })
      await db.apply([{
        entity: book.entity,
        print_quote: { quote },
        $was: guard(book, ['print_review']),
      }])
      return quote
    },
    async purchase(book: Book, pages: Page[]) {
      let doc = document(book, pages), quote = book.print_quote?.quote
      if (!quote || quote.document !== doc.id) {
        throw new Refusal('Request a quote for the document you reviewed.')
      }
      if (!(Date.parse(String(quote.expires)) > Date.now())) {
        throw new Refusal('This quote expired. Request a fresh quote.')
      }
      let receipt = await service('purchase', {
        quote: quote.id,
        document: doc.id,
      })
      await db.apply([{
        entity: book.entity,
        print_receipt: { receipt },
        $was: guard(book, ['print_review', 'print_quote']),
      }])
      return receipt
    },
    async progress(book: Book) {
      let existing = book.print_receipt?.receipt
      if (!existing || existing.historical) return existing ?? null
      let receipt = await service('order_status', { order: existing.id })
      await db.apply([{ entity: book.entity, print_receipt: { receipt } }])
      return receipt
    },
    async cancel(book: Book) {
      if (!book.print_receipt) {
        throw new Refusal('This book has no print order.')
      }
      return await service('cancel', { order: book.print_receipt.receipt.id })
    },
    async file(book: Book, pages: Page[], blob: string) {
      let doc = book.print_review?.document
      let preview = doc?.pages as { blob: string }[] | undefined
      let known = [
        book.character_art?.blob,
        ...pages.map((p) => p.artwork?.blob),
      ]
      if (known.includes(blob)) {
        return await app.fetch('/pay/artifacts/' + blob)
      }
      if (
        !preview?.some((page) => page.blob === blob) &&
        (doc?.interior as { blob: string } | undefined)?.blob !== blob &&
        (doc?.cover as { blob: string } | undefined)?.blob !== blob
      ) throw new Refusal('That document is not available.', 403)
      // The service owns composed files. Reading a private file is an explicit
      // service operation so the consumer never needs seller membership.
      let result = await service('document_file', { document: doc!.id, blob })
      return new Response(
        Uint8Array.from(atob(String(result.base64)), (c) => c.charCodeAt(0)),
        {
          headers: {
            'content-type': String(result.mime),
            'cache-control': 'private, no-store',
          },
        },
      )
    },
    runtime,
  }
}
