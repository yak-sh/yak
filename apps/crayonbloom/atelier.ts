import { type Bundle } from '@yaks/graph'
import {
  allowed,
  guard,
  identifier,
  principal,
  Refusal,
  type Store,
  type Who,
} from './db.ts'
import {
  type Art,
  type Book,
  complete,
  current,
  fingerprint,
  input,
  type Job,
  ordered,
  type Page,
  storyPages,
  type Style,
} from './model.ts'
import { characterPrompt, pagePrompt, singlePrompt } from './prompts.ts'
import { profile } from './puzzles.ts'

export type Outcome = { artwork?: Omit<Art, 'input'>; error?: string }
export type Generator = {
  request(
    job: string,
    prompt: string,
    refs: { blob: string; label: string }[],
  ): Bundle[]
  result(job: string): Promise<Outcome>
}
export type AtelierIO = {
  generate: Generator
  puzzle(
    activity: string,
    age: string,
    text: string,
    seed: number,
  ): Promise<Omit<Art, 'input'>>
}
let selected = [
  'doc',
  'coloring_book',
  'character_art',
  'page_drawing',
  'print_review',
  'print_quote',
  'print_receipt',
  'gallery_consent',
  'book_story',
  'print_preparation',
]
let projection = selected.map((c) => '&?' + c).join('')
export let atelier = (db: Store, io: AtelierIO) => {
  let owned = async (id: unknown, caller: Who): Promise<Book> => {
    let [row] = await db.query(
      `.entity.eid=${identifier(id)}&.coloring_book${projection}`,
    ) as Book[]
    if (!row || !allowed(row.coloring_book, caller)) {
      throw new Refusal('That saved book is not available.', 403)
    }
    return row
  }
  let pages = async (book: Book) =>
    ordered(
      await db.query(
        `.coloring_page.book=${book.entity.eid}&?coloring_page&?artwork&?page_drawing&?page_failed&?page_printable&?page_printable_job`,
      ) as Page[],
    )
  let pageOf = async (book: Book, id: unknown) => {
    let page = (await pages(book)).find((p) => p.entity.eid === identifier(id))
    if (!page) throw new Refusal('That page is not available.', 403)
    return page
  }
  let style = async (book: Book): Promise<Style> => {
    let [row] = await db.query(
      `.entity.eid=${
        identifier(book.coloring_book.style)
      }&?coloring_style&?doc`,
    )
    if (!row?.coloring_style) throw new Refusal('Choose an art style.')
    return {
      ...(row.coloring_style as Style),
      name: String((row.doc as { title: string }).title),
    }
  }
  let start = async (
    book: Book,
    page: Page | null,
    prompt: string,
    refs: { blob: string; label: string }[],
  ) => {
    let job = crypto.randomUUID(),
      target = page ?? book,
      hash = fingerprint(book, page ?? undefined)
    await db.apply([
      {
        entity: { eid: job },
        session: {},
        page_job: {
          book: book.entity.eid,
          page: page?.entity.eid ?? book.entity.eid,
          input: hash,
          role: page ? 'page' : 'character',
        },
      },
      ...io.generate.request(job, prompt, refs),
      {
        entity: target.entity,
        page_drawing: { job },
        page_failed: null,
        $was: {
          ...guard(target, [page ? 'coloring_page' : 'coloring_book']),
          page_drawing: { job: null },
        },
      },
    ])
  }
  let collect = async (book: Book, target: Book | Page) => {
    let drawing = target.page_drawing as { job: string } | undefined
    if (!drawing) return
    let [job] = await db.query(`.entity.eid=${drawing.job}&?page_job`) as Job[]
    if (!job?.page_job) {
      throw new Error('A saved artwork job is missing its input.')
    }
    let result = await io.generate.result(drawing.job)
    if (!result.artwork && !result.error) return
    let page = 'coloring_page' in target ? target as Page : undefined
    let matches = fingerprint(book, page) === job.page_job.input
    await db.apply([{
      entity: target.entity,
      page_drawing: null,
      ...(result.error
        ? { page_failed: { message: result.error } }
        : matches
        ? {
          [page ? 'artwork' : 'character_art']: {
            ...result.artwork,
            input: job.page_job.input,
          },
          page_failed: null,
        }
        : {}),
      $was: guard(target, [
        'page_drawing',
        page ? 'coloring_page' : 'coloring_book',
      ]),
    }])
  }
  return {
    owned,
    pages,
    async shelf(caller: Who) {
      principal(caller)
      let filters = [
        caller.person
          ? `.coloring_book.owner=${identifier(caller.person)}`
          : '',
        caller.via
          ? `.coloring_book.via=${identifier(caller.via)}&!coloring_book.owner`
          : '',
      ].filter(Boolean)
      let all = (await Promise.all(
        filters.map((filter) => db.query(filter + projection)),
      )).flat() as Book[]
      return all.filter((book) => allowed(book.coloring_book, caller))
    },
    async save(value: Record<string, unknown>, caller: Who) {
      let title = String(value.title ?? '').trim().slice(0, 120) ||
          'Untitled coloring book',
        body = String(value.body ?? ''),
        settings = input(value)
      let draft = value.draft ? identifier(value.draft) : crypto.randomUUID()
      let [existing] = value.id
        ? []
        : await db.query(`.entity.eid=${draft}&.coloring_book`)
      let old = value.id || existing
          ? await owned(value.id ?? draft, caller)
          : null,
        entity = old?.entity ?? { eid: draft }
      if (!profile(settings.age).types.length) {
        throw new Refusal('Choose an age range.')
      }
      identifier(settings.style)
      await db.apply([{
        entity,
        doc: { title, body },
        coloring_book: {
          ...settings,
          ...principal(caller),
          ...(old?.coloring_book.via ? { via: old.coloring_book.via } : {}),
        },
        ...(!old || old.doc.title !== title || old.doc.body !== body ||
            JSON.stringify(input(old.coloring_book)) !==
              JSON.stringify(settings)
          ? { print_preparation: null, print_review: null, print_quote: null }
          : {}),
        ...(old
          ? { $was: guard(old, ['doc', 'coloring_book']) }
          : { $was: { entity: { eid: null } } }),
      }])
      return await owned(entity.eid, caller)
    },
    async outline(id: unknown, caller: Who) {
      let book = await owned(id, caller),
        previous = await pages(book),
        parts = storyPages(book.doc.body)
      if (!parts.length && !book.coloring_book.prompt.trim()) {
        throw new Refusal('Save the idea or story you want to draw first.')
      }
      if (!parts.length) parts = [book.coloring_book.prompt]
      if (book.coloring_book.mode === 'free') parts = parts.slice(0, 1)
      let changes: Bundle[] = parts.map((text, position) => ({
        entity: previous[position]?.entity ?? { eid: crypto.randomUUID() },
        coloring_page: {
          book: book.entity.eid,
          position: position + 1,
          prompt: text,
          caption: book.coloring_book.mode === 'story' ? text : '',
          activity: '',
          seed: previous[position]?.coloring_page.seed ?? position + 1,
        },
      }))
      changes.push(
        ...previous.slice(parts.length).map((p) => ({
          entity: p.entity,
          $delete: true,
        })),
      )
      await db.apply([...changes, {
        entity: book.entity,
        print_preparation: null,
        print_review: null,
        print_quote: null,
      }])
      return await pages(book)
    },
    async edit(
      id: unknown,
      pageId: unknown,
      value: Record<string, unknown>,
      caller: Who,
    ) {
      let book = await owned(id, caller), page = await pageOf(book, pageId)
      await db.apply([{
        entity: page.entity,
        coloring_page: {
          prompt: String(value.prompt ?? page.coloring_page.prompt),
          caption: String(value.caption ?? page.coloring_page.caption),
        },
        page_failed: null,
        $was: guard(page, ['coloring_page']),
      }, {
        entity: book.entity,
        print_preparation: null,
        print_review: null,
        print_quote: null,
      }])
    },
    async move(id: unknown, pageId: unknown, delta: number, caller: Who) {
      let book = await owned(id, caller),
        all = await pages(book),
        at = all.findIndex((p) => p.entity.eid === identifier(pageId)),
        other = all[at + Math.sign(delta)]
      if (at < 0) throw new Refusal('That page is not available.', 403)
      if (!other) return
      await db.apply([{
        entity: all[at].entity,
        coloring_page: { position: other.coloring_page.position },
      }, {
        entity: other.entity,
        coloring_page: { position: all[at].coloring_page.position },
      }, {
        entity: book.entity,
        print_preparation: null,
        print_review: null,
        print_quote: null,
      }])
    },
    async addPuzzle(id: unknown, activity: string, caller: Who) {
      let book = await owned(id, caller), all = await pages(book)
      if (!profile(book.coloring_book.age).types.includes(activity)) {
        throw new Refusal('Choose a puzzle suited to this age range.')
      }
      await db.apply([{
        entity: { eid: crypto.randomUUID() },
        coloring_page: {
          book: book.entity.eid,
          position: (all.at(-1)?.coloring_page.position ?? 0) + 1,
          prompt: book.coloring_book.prompt,
          caption: '',
          activity,
          seed: all.length + 1,
        },
      }, {
        entity: book.entity,
        print_preparation: null,
        print_review: null,
        print_quote: null,
      }])
    },
    async retry(id: unknown, pageId: unknown, caller: Who) {
      let book = await owned(id, caller), page = await pageOf(book, pageId)
      if (page.page_drawing) {
        throw new Refusal(
          'This page is still drawing; completed artwork is kept while you wait.',
        )
      }
      await db.apply([{
        entity: page.entity,
        coloring_page: { seed: page.coloring_page.seed + 1 },
        page_failed: null,
      }, {
        entity: book.entity,
        print_preparation: null,
        print_review: null,
        print_quote: null,
      }])
    },
    async advance(id: unknown, caller: Who) {
      let book = await owned(id, caller)
      await collect(book, book)
      book = await owned(id, caller)
      let all = await pages(book)
      for (let page of all) await collect(book, page)
      all = await pages(book)
      let active = all.filter((p) => p.page_drawing).length
      if (book.page_drawing) return { book, pages: all, complete: false }
      if (complete(book, all)) return { book, pages: all, complete: true }
      let selectedStyle = await style(book)
      if (
        book.coloring_book.mode !== 'free' &&
        book.character_art?.input !== fingerprint(book)
      ) {
        if (!book.page_failed) {
          await start(book, null, characterPrompt(book, selectedStyle), [])
        }
        return { book: await owned(id, caller), pages: all, complete: false }
      }
      for (
        let page of all.filter((p) =>
          !current(book, p) && !p.page_drawing && !p.page_failed
        ).slice(0, Math.max(0, 2 - active))
      ) {
        if (page.coloring_page.activity) {
          let art = await io.puzzle(
            page.coloring_page.activity,
            book.coloring_book.age,
            book.coloring_book.prompt,
            page.coloring_page.seed,
          )
          await db.apply([{
            entity: page.entity,
            artwork: { ...art, input: fingerprint(book, page) },
            $was: guard(page, ['coloring_page']),
          }])
        } else {
          let prior = all.findLast((p) =>
            p.coloring_page.position < page.coloring_page.position &&
            !p.coloring_page.activity && p.artwork?.mime.startsWith('image/') &&
            current(book, p)
          )
          let refs = book.coloring_book.mode === 'free' ? [] : [
            {
              blob: book.character_art!.blob,
              label: 'Character reference sheet: keep appearance consistent.',
            },
            ...(prior?.artwork
              ? [{
                blob: prior.artwork.blob,
                label:
                  'Earlier page: appearance only; draw a different composition.',
              }]
              : []),
          ]
          await start(
            book,
            page,
            book.coloring_book.mode === 'free'
              ? singlePrompt(book, page, selectedStyle)
              : pagePrompt(book, page, selectedStyle, !!prior),
            refs,
          )
        }
      }
      all = await pages(book)
      return {
        book: await owned(id, caller),
        pages: all,
        complete: complete(book, all),
      }
    },
    async consent(id: unknown, agree: boolean, caller: Who) {
      let book = await owned(id, caller)
      await db.apply([{
        entity: book.entity,
        gallery_consent: agree ? { at: new Date().toISOString() } : null,
      }])
    },
  }
}
