// A search link dropped on a canvas becomes a live board there. The link
// itself carries no board spec: outside the canvas it remains an ordinary URL.
import { queryAt } from '@yaks/query'

export let searchBoard = (raw: string, origin: string): {
  doc: { title: string; body: string }
  board: { query: string }
} | null => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.origin != origin || url.pathname != '/') return null
  let query = queryAt(url.search).query?.trim()
  return query ? { doc: { title: query, body: '' }, board: { query } } : null
}
