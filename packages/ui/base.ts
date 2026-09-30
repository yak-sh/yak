/**
 * The document's defaults, in a terminal: base.css's twin. @yaks/tui's
 * painter already knows what a heading, `strong` or `em` means, and what its
 * own widgets are without colour; this gives code, quotes and highlight.js's
 * syntax their colours, a bare anchor the link colour base.css gives one
 * (@yaks/tui paints it with `Link`), and the painter's widgets (tables,
 * scrollbars, panels, the text entry, a selected row) the theme's, the way
 * base.css gives a browser's scrollbars theirs.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import type { Colors, Specimen } from './theme.ts'

/** The terminal entries, in `c`. */
export let sheet = (c: Colors): Sheet => ({
  Code: { fg: c.blue, bg: c.card },
  Quote: { fg: c.text, bg: c.card },
  Link: { fg: c.link, underline: true },
  'hljs-keyword': { fg: c.red },
  'hljs-selector-tag': { fg: c.red },
  'hljs-literal': { fg: c.purple },
  'hljs-number': { fg: c.purple },
  'hljs-string': { fg: c.accent },
  'hljs-addition': { fg: c.accent },
  'hljs-title': { fg: c.blue },
  'hljs-section': { fg: c.blue, bold: true },
  'hljs-built_in': { fg: c.yellow },
  'hljs-type': { fg: c.yellow },
  'hljs-attr': { fg: c.orange },
  'hljs-variable': { fg: c.orange },
  'hljs-comment': { fg: c.dim, italic: true },
  'hljs-meta': { fg: c.dim },
  'hljs-deletion': { fg: c.red },
  Muted: { fg: c.muted },
  Table_Border: { fg: c.dim, dim: true },
  Scrollbar: { fg: c.dim },
  Panel_Title: { fg: c.dim, bold: true },
  List_Selected: { bg: c.card },
  Entry: { fg: c.text },
  Entry_Hint: { fg: c.dim, dim: true },
})

// Syntax, as highlight.js marks it up.
let hl = (kind: string, text: string) =>
  h('span', { class: `hljs-${kind}` }, text)

/** Prose, as the defaults dress it. */
export let specimens = (): Specimen[] => [
  [
    'text',
    h(
      'p',
      null,
      'A paragraph with ',
      h('strong', null, 'strong'),
      ', ',
      h('em', null, 'emphasis'),
      ', ',
      h('code', null, 'code'),
      ' and ',
      h('a', { href: '#base' }, 'a link'),
      '.',
    ),
  ],
  [
    'code',
    h(
      'pre',
      null,
      h(
        'code',
        null,
        hl('keyword', 'let'),
        ' ',
        hl('variable', 'n'),
        ' = ',
        hl('number', '1'),
        ' ',
        hl('comment', '// one'),
        '\n',
        hl('title', 'say'),
        '(',
        hl('string', "'hello'"),
        ')',
      ),
    ),
  ],
  ['quote', h('blockquote', null, 'Said elsewhere, quoted here.')],
  [
    'table',
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h('tr', null, h('th', null, 'name'), h('th', null, 'value')),
      ),
      h(
        'tbody',
        null,
        h('tr', null, h('td', null, 'gap'), h('td', null, '0.75rem')),
      ),
    ),
  ],
  ['list', h('ul', null, h('li', null, 'one'), h('li', null, 'two'))],
]
