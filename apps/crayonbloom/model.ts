import { type Bundle, sha256 } from '@yaks/graph'
export type Input = {
  owner?: string
  via?: string
  prompt: string
  age: string
  style: string
  character: string
  mode: string
  personalization: string
  dedication: string
}
export type Art = { blob: string; mime: string; hash: string; input: string }
export type Book = Bundle & {
  doc: { title: string; body: string }
  coloring_book: Input
  character_art?: Art
  page_drawing?: { job: string }
  page_failed?: { message: string }
  print_review?: { document: Record<string, unknown> }
  print_quote?: { quote: Record<string, unknown> }
  print_receipt?: { receipt: Record<string, unknown> }
}
export type Page = Bundle & {
  coloring_page: {
    book: string
    position: number
    prompt: string
    caption: string
    activity: string
    seed: number
  }
  artwork?: Art
  page_drawing?: { job: string }
  page_failed?: { message: string }
}
export type Style = {
  name: string
  prompt_modifier: string
  subject_portrayal?: string | null
  edge_direction?: string | null
  motif_vocabulary?: string
  page_band?: string | null
}
export type Job = Bundle & {
  page_job: { book: string; page: string; input: string; role: string }
  session?: { status: string }
}
export let ordered = (pages: Page[]) =>
  pages.slice().sort((a, b) =>
    a.coloring_page.position - b.coloring_page.position
  )
export let fingerprint = (book: Book, page?: Page) =>
  sha256(
    JSON.stringify([
      book.coloring_book.prompt,
      book.coloring_book.age,
      book.coloring_book.style,
      book.coloring_book.character,
      book.coloring_book.personalization,
      page
        ? [
          page.coloring_page.prompt,
          page.coloring_page.activity,
          page.coloring_page.seed,
        ]
        : null,
    ]),
  )
export let current = (book: Book, page: Page) =>
  page.artwork?.input === fingerprint(book, page)
export let complete = (book: Book, pages: Page[]) =>
  !!pages.length &&
  pages.every((page) => current(book, page) && !page.page_drawing)
export let storyPages = (body: string) =>
  body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
export let input = (
  value: Record<string, unknown>,
): Omit<Input, 'owner' | 'via'> => ({
  prompt: String(value.prompt ?? ''),
  age: String(value.age ?? '4-8'),
  style: String(value.style ?? ''),
  character: String(value.character ?? ''),
  mode: String(value.mode ?? 'story'),
  personalization: String(value.personalization ?? '').slice(0, 100),
  dedication: String(value.dedication ?? '').slice(0, 2000),
})
