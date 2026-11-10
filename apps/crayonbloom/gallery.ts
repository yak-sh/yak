import { type Binding, identifier, Refusal, type Store } from './db.ts'
import type { Page } from './model.ts'
export let gallery = (db: Store, app: Binding) => {
  let selected = async (id: string) => {
    let [page] = await db.query(
      `.entity.eid=${identifier(id)}&.gallery_approved&?coloring_page&?artwork`,
    ) as Page[]
    if (!page?.artwork || !page.coloring_page) return null
    let [book] = await db.query(
      `.entity.eid=${page.coloring_page.book}&.gallery_consent`,
    )
    return book ? page : null
  }
  return {
    async list() {
      let candidates = await db.query(
          '.gallery_approved&?coloring_page&?artwork',
        ) as Page[],
        rows = []
      let books = [
        ...new Set(
          candidates.map((p) => p.coloring_page?.book).filter(Boolean),
        ),
      ]
      let consented = new Set(
        books.length
          ? (await db.query(`.entity.eid=${books.join(',')}&.gallery_consent`))
            .map((b) => b.entity.eid)
          : [],
      )
      for (let page of candidates) {
        if (page.artwork && consented.has(page.coloring_page.book)) {
          rows.push({
            id: page.entity.eid,
            caption: page.coloring_page.caption,
            mime: page.artwork.mime,
          })
        }
      }
      return rows
    },
    async file(id: string) {
      let page = await selected(id)
      if (!page) throw new Refusal('This gallery page is not available.', 403)
      let response = await app.fetch('/pay/artifacts/' + page.artwork!.blob)
      return new Response(response.body, {
        status: response.status,
        headers: {
          'content-type': page.artwork!.mime,
          'cache-control': 'no-store',
        },
      })
    },
  }
}
