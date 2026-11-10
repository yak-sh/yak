import { type Bundle } from '@yaks/graph'
import { guard, Refusal, type Store } from './db.ts'
import type { Runtime } from './generation.ts'
import { type Book, fingerprint } from './model.ts'

export type Story = {
  character?: string
  pages: { prompt: string; caption: string }[]
}
export let parseStory = (text: string): Story => {
  let value = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''))
  if (
    !Array.isArray(value.pages) || !value.pages.length ||
    value.pages.length > 48 ||
    value.pages.some((p: { prompt?: unknown; caption?: unknown }) =>
      typeof p.prompt !== 'string' || !p.prompt.trim() ||
      typeof p.caption !== 'string'
    )
  ) {
    throw new Error(
      'The story response did not contain usable pages. Your saved idea is kept.',
    )
  }
  return value
}
let prompt = (book: Book, style: Record<string, unknown>) =>
  `Write an age-appropriate illustrated coloring-book story from this parent's own idea: ${book.coloring_book.prompt}. Age range: ${book.coloring_book.age}. Character information: ${book.coloring_book.character}. Personalization: ${book.coloring_book.personalization}. Art style: ${
    style.prompt_modifier ?? ''
  }. Available visual motifs: ${
    style.motif_vocabulary ?? ''
  }. Make six varied scenes forming a complete story. Return only JSON {"character":"consistent appearance reference brief","pages":[{"prompt":"a specific new visual scene, camera angle and composition","caption":"one short sentence of the story"}]}. Respect the parent's content and style. Do not infer personal details they did not supply.`
let fixture = (book: Book): Story => ({
  character: book.coloring_book.character || book.coloring_book.prompt,
  pages: [1, 2, 3, 4].map((n) => ({
    prompt: `${book.coloring_book.prompt} · fixture scene ${n}`,
    caption: `Fixture story page ${n}: ${book.coloring_book.prompt}`,
  })),
})
export let story = (db: Store, runtime: Runtime) => async (book: Book) => {
  if (!book.coloring_book.prompt.trim()) {
    throw new Refusal('Save the idea you want your book to tell first.')
  }
  let selected = book.book_story as { job: string } | undefined
  if (!selected) {
    let job = crypto.randomUUID(),
      [style] = await db.query(
        `.entity.eid=${book.coloring_book.style}&?coloring_style`,
      )
    await db.apply([{
      entity: { eid: job },
      session: {},
      story_job: {
        book: book.entity.eid,
        source: fingerprint(book),
        body: book.doc.body,
      },
    }, {
      entity: { eid: crypto.randomUUID() },
      entry: { session: job, seq: 1 },
      content: {
        body: prompt(
          book,
          style?.coloring_style as Record<string, unknown> ?? {},
        ),
      },
      ...(!runtime.preview
        ? {
          using: {
            provider: 'workers-ai',
            model: runtime.story_model ?? '@cf/zai-org/glm-5.3-flash',
          },
          sending: { instructions: 'Answer the requested story JSON only.' },
        }
        : {}),
    }, {
      entity: book.entity,
      book_story: { job },
      $was: {
        ...guard(book, ['doc', 'coloring_book']),
        book_story: { job: null },
      },
    }])
    return { pending: true, job }
  }
  let [request] = await db.query(`.entity.eid=${selected.job}&?story_job`)
  let original = request.story_job as { source: string; body: string }
  if (
    original.source !== fingerprint(book) || original.body !== book.doc.body
  ) {
    throw new Refusal(
      'Your idea or story changed while this suggestion was being written. Keep your edit, or ask for another suggestion.',
    )
  }
  let result: Story
  if (runtime.preview) result = fixture(book)
  else {
    let rows = await db.query(
      `.entry.session=${selected.job}&?content&?output&?refusal`,
    )
    if (rows.some((r) => r.refusal)) {
      throw new Refusal(
        'The story could not be suggested. Your saved idea is kept.',
      )
    }
    let answer = rows.findLast((r) => r.output && r.content)
    if (!answer) return { pending: true, job: selected.job }
    result = parseStory(String((answer.content as { body: string }).body))
  }
  let existing = await db.query(`.coloring_page.book=${book.entity.eid}`)
  let updates: Bundle[] = result.pages.map((page, index) => ({
    entity: { eid: crypto.randomUUID() },
    coloring_page: {
      book: book.entity.eid,
      position: index + 1,
      prompt: page.prompt,
      caption: page.caption,
      activity: '',
      seed: index + 1,
    },
  }))
  await db.apply([
    ...existing.map((row) => ({ entity: row.entity, $delete: true })),
    ...updates,
    {
      entity: book.entity,
      doc: { body: result.pages.map((p) => p.caption).join('\n\n') },
      coloring_book: {
        ...(book.coloring_book.character || !result.character
          ? {}
          : { character: result.character }),
      },
      book_story: null,
      print_review: null,
      print_quote: null,
      $was: guard(book, ['doc', 'coloring_book', 'book_story']),
    },
  ])
  return { pending: false }
}
