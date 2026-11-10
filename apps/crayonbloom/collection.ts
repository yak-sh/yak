import type { atelier } from './atelier.ts'
import { identifier, Refusal, type Store, type Who } from './db.ts'
import { type Book, current, fingerprint, type Page } from './model.ts'

export let collection = (db: Store, engine: ReturnType<typeof atelier>) => ({
  async list(caller: Who) {
    let rows = []
    for (let book of await engine.shelf(caller)) {
      for (let page of await engine.pages(book)) {
        if (current(book, page)) {
          rows.push({ book: book.entity.eid, title: book.doc.title, page })
        }
      }
    }
    return rows
  },
  async assemble(book: Book, ids: unknown, caller: Who) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) {
      throw new Refusal(
        'Choose up to 100 saved pages to gather into this book.',
      )
    }
    let changes = [], position = (await engine.pages(book)).length
    for (let id of [...new Set(ids)]) {
      let [page] = await db.query(
        `.entity.eid=${identifier(id)}&?coloring_page&?artwork`,
      ) as Page[]
      if (!page?.coloring_page) {
        throw new Refusal('One of those pages is not available.', 403)
      }
      let source = await engine.owned(page.coloring_page.book, caller)
      if (!current(source, page)) {
        throw new Refusal('Finish the selected page before gathering it.')
      }
      let copy: Page = {
        entity: { eid: crypto.randomUUID() },
        coloring_page: {
          ...page.coloring_page,
          book: book.entity.eid,
          position: ++position,
        },
      }
      copy.artwork = { ...page.artwork!, input: fingerprint(book, copy) }
      changes.push(copy)
    }
    await db.apply([...changes, {
      entity: book.entity,
      print_review: null,
      print_quote: null,
      print_preparation: null,
    }])
    return { ok: true }
  },
})
