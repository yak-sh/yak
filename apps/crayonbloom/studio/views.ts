/** The studio's screens, each a function of what was last drawn: the shelf
 * of a person's books, and the editor of one, where an idea becomes a story,
 * pages and a printed copy. They fetch nothing and hold nothing; what a
 * press or a keystroke means is the page's (run.ts), which hears them by
 * the roles written here (`data-source`, `data-act` and the rest).
 *
 * A field shows the saved value it was drawn with and is the person's from
 * then on, so it takes a `defaultValue`. Everything typed in sits under one
 * key, the draw's number: a new draw puts every field back to what is
 * saved, and a new notice touches none of them. */
import { Fragment, h } from 'preact'
import {
  Button,
  Card,
  Cards,
  Check,
  Empty,
  Field,
  Form,
  Notice,
  State,
} from '@yaks/ui/parts'
import { Desk } from '../look/parts/Desk.ts'
import { Kicker } from '../look/parts/Kicker.ts'
import { Lead } from '../look/parts/Lead.ts'
import { Tray } from '../look/parts/Tray.ts'
import { Bottom, type Place, Top } from '../pages/chrome.ts'
import { Labeled, options, press } from './kit.ts'
import { Leaves } from './leaves.ts'
import { Print } from './print.ts'
import type { Book, Leaf, Offered, Settings } from './rows.ts'

/** What the studio shows: the last draw of a screen, and the line it says
 * back. */
export type Studio = {
  place: Place
  /** nothing until the first read answers */
  screen: 'opening' | 'shelf' | 'book'
  /** counts the draws; a new one puts every field back to what is saved */
  drawn: number
  settings: Settings | null
  shelf: Book[]
  /** the book being edited, once it has been saved */
  book: Book | null
  pages: Leaf[]
  /** what a new book's idea starts as */
  idea: string
  /** the finished pages offered for gathering, once asked for */
  gather: Offered[] | null
  notice: { text: string; negative?: boolean }
}

let Said = ({ text, negative }: Studio['notice']) =>
  h(
    Notice,
    { role: 'status', 'aria-live': 'polite', mod: negative && 'negative' },
    text,
  )

/** How a book stands on the shelf: its tone, and the words for it. */
let stands = (book: Book): [string | undefined, string] =>
  book.print_receipt
    ? ['positive', 'Print receipt saved']
    : book.print_review
    ? ['info', 'Ready for document review']
    : [undefined, 'Saved idea and pages']

/** A person's books, and where a new one starts. */
export let Shelf = ({ place, settings, shelf, notice }: Studio) =>
  h(
    Desk,
    {},
    h(
      Desk.Head,
      {},
      h(Kicker, {}, 'Your shelf'),
      h(Desk.Title, {}, 'Your personal shelf'),
      h(
        Lead.Lede,
        {},
        'Start with your child’s idea. Save a page, build a story, or gather completed pages into a book.',
      ),
      settings?.preview && h(
        Notice,
        { mod: 'fine' },
        'Fixture preview · no paid generation, payment or print fulfillment.',
      ),
    ),
    h(Said, notice),
    h(
      Desk.Row,
      {},
      h(Button, { mod: 'go', href: '#new' }, 'Start an idea'),
      h(
        Button,
        { href: place.at('/free_pages/resume') },
        'Resume a free page',
      ),
    ),
    shelf.length
      ? h(
        Cards,
        {},
        shelf.map((book) => {
          let [tone, said] = stands(book)
          return h(
            Card,
            { mod: 'button', href: '#book/' + book.entity.eid },
            h(Card.Title, {}, book.doc.title),
            h(State, { mod: tone }, said),
          )
        }),
      )
      : h(
        Empty,
        {},
        h(Empty.Title, {}, 'No saved ideas yet'),
        h(
          'p',
          {},
          'Start an idea and it is kept here, with every page drawn from it.',
        ),
      ),
  )

let MODES: [string, string][] = [
  ['story', 'Story coloring book'],
  ['coloring', 'Coloring book'],
  ['free', 'Free coloring page'],
]
let AGES: [string, string][] = [
  ['2-4', 'Ages 2–4'],
  ['4-8', 'Ages 4–8'],
  ['8-12', 'Ages 8–12'],
  ['13+', 'Ages 13 and up'],
]

/** The idea a book is made from. Its hidden `body` carries the story, which
 * is written in the card beside it, into the same save. */
let Idea = ({ settings, book, idea }: Studio) => {
  let s = book?.coloring_book, styles = settings?.styles ?? []
  return h(
    Card,
    {},
    h(Card.Head, {}, h(Card.Title, {}, 'Your idea')),
    h(
      Form,
      { 'data-source': true },
      h(Labeled, {
        id: 'idea-title',
        title: 'Book title',
        name: 'title',
        defaultValue: book?.doc.title,
      }),
      h(Labeled, {
        id: 'idea-prompt',
        title: 'Your idea',
        name: 'prompt',
        lines: true,
        defaultValue: s?.prompt ?? idea,
      }),
      h(
        Labeled,
        { id: 'idea-mode', title: 'Make a', name: 'mode', choose: true },
        options(MODES, s?.mode ?? 'story'),
      ),
      h(
        Labeled,
        { id: 'idea-age', title: 'Age range', name: 'age', choose: true },
        options(AGES, s?.age ?? '4-8'),
      ),
      h(
        Labeled,
        { id: 'idea-style', title: 'Art style', name: 'style', choose: true },
        options(
          styles.map((style) => [style.entity.eid, style.doc.title]),
          s?.style ?? styles[0]?.entity.eid,
        ),
      ),
      h(Labeled, {
        id: 'idea-character',
        title: 'Character appearance',
        name: 'character',
        optional: true,
        defaultValue: s?.character,
      }),
      h(Labeled, {
        id: 'idea-personalization',
        title: 'First name on the book',
        name: 'personalization',
        optional: true,
        defaultValue: s?.personalization,
      }),
      h(Labeled, {
        id: 'idea-dedication',
        title: 'Dedication',
        name: 'dedication',
        optional: true,
        defaultValue: s?.dedication,
      }),
      h('input', { type: 'hidden', name: 'body' }),
      h(
        Form.Hint,
        {},
        'Your idea and edits are saved. Finished artwork stays on your shelf if drawing is interrupted.',
      ),
      h(
        Form.Actions,
        {},
        h(Button, { type: 'submit', mod: 'go' }, 'Save idea'),
        press('story', 'Suggest a story'),
      ),
    ),
  )
}

/** The finished pages a person may gather into this book. */
let Gather = ({ gather }: { gather: Offered[] }) =>
  h(
    Form,
    { 'data-collection-form': true },
    gather.map((item) =>
      h(
        Check,
        {},
        h(Check.Input, {
          type: 'checkbox',
          name: 'page',
          value: item.page.entity.eid,
        }),
        `${item.title} · page ${item.page.coloring_page.position}`,
      )
    ),
    !gather.length &&
      h(Tray.Note, {}, 'Your shelf has no finished pages to gather yet.'),
    h(Form.Actions, {}, h(Button, { type: 'submit' }, 'Gather selected pages')),
  )

/** The story, a paragraph a scene, and what a saved book does with it:
 * become pages, take a puzzle, gather pages, go to print. */
let Story = ({ book, gather }: Studio) => {
  let s = book?.coloring_book
  return h(
    Card,
    {},
    h(Card.Head, {}, h(Card.Title, {}, 'Your editable story')),
    h(
      Card.Sub,
      {},
      'Edit the story a paragraph at a time. Each paragraph becomes one scene when you choose Use story as pages.',
    ),
    h(Field, {
      lines: true,
      name: 'body',
      'data-story-text': true,
      'aria-label': 'Your editable story',
      defaultValue: book?.doc.body ?? '',
    }),
    h(
      Desk.Row,
      {},
      press('outline', 'Use story as pages'),
      press('draw', 'Draw or resume saved pages'),
    ),
    book?.page_failed && [
      h(Notice, { mod: 'negative' }, book.page_failed.message),
      h(Desk.Row, {}, press('retry_character', 'Retry character sheet')),
    ],
    s?.mode == 'free' &&
      h(Desk.Row, {}, press('freebook', 'Build a book from this page')),
    book && [
      h(
        Tray,
        { mod: 'ruled' },
        h(Tray.Title, {}, 'Add a puzzle'),
        h(
          Desk.Row,
          {},
          press('puzzle', 'Maze', { 'data-kind': 'maze' }),
          press('puzzle', 'Dot-to-dot', { 'data-kind': 'connect_the_dots' }),
          s?.age != '2-4' &&
            press('puzzle', 'Word search', { 'data-kind': 'word_search' }),
        ),
      ),
      h(
        Tray,
        { mod: 'ruled' },
        h(Tray.Title, {}, 'Gather saved pages'),
        h(Desk.Row, {}, press('choose', 'Choose pages from your shelf')),
        gather && h(Gather, { gather }),
      ),
      h(
        Tray,
        { mod: 'ruled' },
        h(Tray.Title, {}, 'Prepare for print'),
        h(
          Desk.Row,
          {},
          press('connect', 'Connect PrintBound'),
          press('prepare', 'Prepare print document'),
        ),
        h(
          Tray.Note,
          {},
          'You review the complete document before requesting a destination quote.',
        ),
      ),
    ],
  )
}

let Consent = ({ book }: { book: Book }) =>
  h(
    Card,
    {},
    h(
      Check,
      {},
      h(Check.Input, {
        type: 'checkbox',
        'data-gallery': true,
        defaultChecked: !!book.gallery_consent,
      }),
      'I consent to this book’s artwork being considered for the public gallery.',
    ),
    h(
      Card.Sub,
      {},
      'Sharing is optional and requires review. This does not subscribe you to marketing mail.',
    ),
  )

/** One book: its idea beside its story, then its pages, its print and
 * whether its artwork may be shared. */
export let Editor = (s: Studio) =>
  h(
    Desk,
    {},
    h(
      Desk.Head,
      {},
      h(Button, { mod: 'quiet', href: '#' }, '← Your shelf'),
      h(Desk.Title, {}, s.book?.doc.title ?? 'Make something they can color'),
      s.settings?.preview && h(
        Notice,
        { mod: 'fine' },
        'Fixture preview · artwork and story suggestions are demonstrations. No model calls, payments or print orders run.',
      ),
    ),
    h(Said, s.notice),
    h(
      Fragment,
      { key: s.drawn },
      h(Desk.Pair, {}, h(Idea, s), h(Story, s)),
      s.book && s.pages.length > 0 &&
        h(Leaves, { place: s.place, book: s.book, pages: s.pages }),
      h(Print, { place: s.place, book: s.book }),
      s.book && h(Consent, { book: s.book }),
    ),
  )

let Opening = ({ notice }: Studio) =>
  h(Desk, {}, h('p', {}, 'Opening your saved ideas…'), h(Said, notice))

let SCREENS = { opening: Opening, shelf: Shelf, book: Editor }

/** The whole page: the header, the screen the address names, the footer. */
export let Page = (s: Studio) =>
  h(
    Fragment,
    {},
    h(Top, { place: s.place, account: true }),
    h(SCREENS[s.screen], s),
    h(Bottom, { place: s.place }),
  )
