import text from './prompt-text.json' with { type: 'json' }
import type { Book, Page, Style } from './model.ts'
let age: Record<string, string> = {
  '2-4':
    'Very simple coloring page for ages 2-4 with large shapes, minimal background clutter, and broad open spaces',
  '4-8':
    'Balanced coloring page for ages 4-8 with readable details and comfortable open spaces',
  '8-12':
    'More detailed coloring page for ages 8-12 with layered props, richer backgrounds, and intricate but clear coloring spaces',
  '13+':
    'Sophisticated coloring page for ages 13+ with fine linework, dense patterns, and intricate detailed compositions',
}
let styleText = (style: Style, character = false) =>
  [text.STYLE, style.prompt_modifier, character ? style.subject_portrayal : '']
    .filter(Boolean).join(' ')
export let characterPrompt = (book: Book, style: Style) =>
  [
    styleText(style, true),
    `Reference sheet of the main recurring characters. ${
      book.coloring_book.character || book.coloring_book.prompt
    }. ${
      book.coloring_book.personalization
        ? 'The story’s star is named ' + book.coloring_book.personalization +
          '.'
        : ''
    } Show each character full-body, front view, neutral pose, clearly separated on one white page.`,
    text.SHEET_NO_TEXT,
  ].join('\n\n')
export let pagePrompt = (
  book: Book,
  page: Page,
  style: Style,
  prior: boolean,
) =>
  [
    styleText(style),
    [
      text.PRINTED_PAGE,
      style.edge_direction,
      style.edge_direction ? text.UNLETTERED_PAGE : '',
    ].filter(Boolean).join(' '),
    age[book.coloring_book.age] ?? age['4-8'],
    text.CHARACTER_SHEET_ANCHOR,
    prior ? text.PRIOR_PAGE_ANCHOR : '',
    `Draw a new scene: ${page.coloring_page.prompt}. Keep recurring characters true to Image 1.`,
    text.SUBORDINATE_DETAIL,
  ].filter(Boolean).join('\n\n')

export let singlePrompt = (book: Book, page: Page, style: Style) =>
  [
    styleText(style, true),
    text.PRINTED_PAGE,
    age[book.coloring_book.age] ?? age['4-8'],
    `Draw one self-contained coloring page for: ${page.coloring_page.prompt}`,
  ].join('\n\n')
