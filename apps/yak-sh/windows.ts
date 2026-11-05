// Each door's window in the bands, drawn as the interface it stands for: the
// terminal, your agent's chat with the tool it called, the web canvas in a
// browser, the letter the outbox was handed, and a new session's terminal UI
// with what it was given. Each is a drawing on the page's paper in its own
// inks, not a screenshot: no window shows a disclosure mark, since nothing in
// one opens.
import { type ComponentChildren, h } from 'preact'
import type { Bundle } from '@yaks/graph'
import type { Decision } from '@yaks/task'
import { called } from './site.ts'
import { text } from './told.ts'
import { SHOP } from './shop.ts'

/** What a door's window draws: the beat's line, what came back, the entity
 * it changed, and each eid by its short id. */
export type Shown = {
  kind: string
  line: string
  out: string[]
  fault: boolean
  row?: Bundle
  find: (eid: string) => Bundle | undefined
  id: (eid: string) => string
}

/** The sign a door's line wears in the beat beside its window. */
export const SIGNS: Record<string, string> = {
  web: 'page → ',
  mcp: 'agent → ',
  sh: '$ ',
  session: 'wears ',
  reply: 'you reply: ',
}

let said = (s: Shown) =>
  s.out.map((line) =>
    h('div', { class: s.fault ? 'is-fault' : undefined }, line || ' ')
  )

let value = (v: unknown) => typeof v == 'string' ? v : JSON.stringify(v)

/** A wrench, the mark a chat client puts on a tool it called. */
let WRENCH = h(
  'svg',
  { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  h('path', {
    d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  }),
)

/** A terminal: the command typed after its prompt, and what it printed. */
let Term = (s: Shown) => [
  h('div', { class: 'Term_Bar' }, [
    h('i', null),
    h('i', null),
    h('i', null),
    h('span', null, 'zsh'),
  ]),
  h('div', { class: 'Term_Screen' }, [
    h('div', { class: 'Term_In' }, [h('span', null, '$ '), s.line]),
    ...said(s),
  ]),
]

/** Your agent's chat: the tool it called, its arguments and what came back,
 * as a chat client shows a tool call. */
let Chat = (s: Shown) => {
  let { tool, args } = called(s.line)
  return [
    h('div', { class: 'Chat_Head' }, [
      h('span', { class: 'Chat_Face', 'aria-hidden': 'true' }),
      h('b', null, 'Your agent'),
      h('span', null, 'over MCP'),
    ]),
    h('div', { class: 'Chat_Call' }, [
      h('div', { class: 'Chat_Tool' }, [WRENCH, h('code', null, tool)]),
      h(
        'dl',
        null,
        Object.entries(args).flatMap(([k, v]) => [
          h('dt', null, k),
          h('dd', null, value(v)),
        ]),
      ),
      h('div', { class: 'Chat_Result' }, said(s)),
    ]),
    h(
      'div',
      { class: 'Chat_Say', 'aria-hidden': 'true' },
      'Reply to your agent',
    ),
  ]
}

/** The entity a page call changed, as the web canvas draws it: a task with
 * its box, a question with its choices, a comment under what it is on. */
let Drawn = (s: Shown, row: Bundle): ComponentChildren => {
  let head = (r: Bundle) =>
    h('div', { class: 'Page_Title' }, [
      r.task
        ? h('span', {
          class: `Page_Box${
            text(r, 'task', 'status') == 'done' ? ' is-on' : ''
          }`,
        })
        : null,
      h('span', { class: 'Page_Id' }, s.id(r.entity.eid)),
      h('b', null, text(r, 'doc', 'title')),
    ])
  if (row.comment) {
    let on = s.find(text(row, 'comment', 'target'))
    return [
      on ? head(on) : null,
      h('div', { class: 'Page_Comment' }, [
        h('span', null, s.id(text(row, 'created', 'by'))),
        h('p', null, text(row, 'doc', 'body')),
      ]),
    ]
  }
  let choices = (row.decision as { choices?: { label: string }[] } | undefined)
    ?.choices ?? []
  let chose = text(row, 'decided', 'choice')
  return [
    head(row),
    choices.length
      ? h(
        'ul',
        { class: 'Page_Choices' },
        choices.map((c) =>
          h('li', { class: c.label == chose ? 'is-on' : undefined }, c.label)
        ),
      )
      : h('div', { class: 'Page_State' }, text(row, 'task', 'status')),
  ]
}

/** The web canvas in a browser: the page at the address `yak serve` gives,
 * what the call changed drawn on it, and the call in its status line. */
let Page = (s: Shown) => [
  h('div', { class: 'Page_Bar' }, [
    h('span', { class: 'Page_Nav', 'aria-hidden': 'true' }, '← →'),
    h('span', { class: 'Page_Address' }, '127.0.0.1:8787'),
  ]),
  h('div', { class: 'Page_Body' }, s.row ? Drawn(s, s.row) : said(s)),
  h('div', { class: 'Page_Status' }, `called ${called(s.line).tool}`),
]

let field = (k: string, v: string) => [h('dt', null, k), h('dd', null, v)]

/** What happened to a letter, a line each. */
let Happened = (s: Shown) =>
  h(
    'ol',
    { class: 'Letter_Tries', 'aria-label': 'What happened to it' },
    s.out.map((line) => h('li', null, line)),
  )

/** The letter the mail effect handed the mail service: the question it is
 * about with each choice, what it asks of you, and what happened to it. */
let Letter = (s: Shown) => {
  let r = s.row
  let about = r ? s.find(text(r, 'mail', 'target')) : undefined
  let d = about?.decision as Decision | undefined
  return [
    h('div', { class: 'Letter_Stamp', 'aria-hidden': 'true' }),
    h('dl', { class: 'Letter_Head' }, [
      ...r ? field('From', text(r, 'mail', 'from')) : [],
      ...r ? field('To', text(r, 'mail', 'to')) : [],
      ...field('Subject', r ? text(r, 'doc', 'title') : s.line),
    ]),
    r
      ? h('div', { class: 'Letter_Body' }, [
        d ? h('p', null, d.question) : null,
        d
          ? h(
            'ol',
            { class: 'Letter_Choices' },
            d.choices.map((c) =>
              h('li', null, [
                h('b', null, c.label),
                `: ${c.description}`,
                c.label == d.recommended ? ' (recommended)' : '',
              ])
            ),
          )
          : null,
        h('p', null, text(r, 'doc', 'body')),
      ])
      : null,
    Happened(s),
  ]
}

/** Your reply to a letter, as your mail client writes it: to whom, about
 * what, your words, and what it did once it arrived. */
let Reply = (s: Shown) => {
  let [subject, words] = s.line.split('\n')
  return [
    h('dl', { class: 'Letter_Head' }, [
      ...field('To', SHOP),
      ...field('Subject', `Re: ${subject}`),
    ]),
    h('div', { class: 'Letter_Body' }, h('p', null, words)),
    Happened(s),
  ]
}

/** A new session's terminal UI: the persona it wears in its title bar, and
 * the context it starts with. */
let Session = (s: Shown) => [
  h('div', { class: 'Tui_Bar' }, [
    h('b', null, 'new session'),
    h('span', null, `wears ${s.line}`),
  ]),
  h(
    'div',
    { class: 'Tui_Screen' },
    s.out.map((line) =>
      h(
        'div',
        { class: line.startsWith('#') ? 'is-head' : undefined },
        line || ' ',
      )
    ),
  ),
  h('div', { class: 'Tui_Foot' }, [
    h('span', null, 'context'),
    h('span', null, `${s.out.filter((l) => l.startsWith('# ')).length} parts`),
  ]),
]

let LOOKS: Record<string, [string, (s: Shown) => ComponentChildren]> = {
  sh: ['Term', Term],
  mcp: ['Chat', Chat],
  web: ['Page', Page],
  outbox: ['Letter', Letter],
  reply: ['Letter', Reply],
  session: ['Tui', Session],
}

/** A door's window: its interface's look, by the door's kind. */
export let Look = (s: Shown & { class?: string; style?: string }) => {
  let [look, draw] = LOOKS[s.kind] ?? LOOKS.sh
  return h('div', {
    class: `Window ${look}${s.class ? ` ${s.class}` : ''}`,
    'data-door': s.kind,
    style: s.style,
  }, draw(s))
}
