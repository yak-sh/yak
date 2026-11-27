// Each door's window in the bands, drawn as the interface it stands for: the
// terminal, your agent's chat with the tool it called, the web canvas in a
// browser, the letter the outbox was handed, and a new session's terminal UI
// with what it was given. Each is a drawing on the page's paper in its own
// inks, not a screenshot: no window shows a disclosure mark, since nothing in
// one opens.
import { createElement as h, type ReactNode } from 'react'
import type { Bundle } from '@yaks/graph'
import { called } from './site.ts'
import { text } from './told.ts'
import { SHOP } from './shop.ts'
import { Prose } from './prose.ts'

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
    h('div', { className: s.fault ? 'is-fault' : undefined }, line || ' ')
  )

let value = (v: unknown) => typeof v == 'string' ? v : JSON.stringify(v)

/** A wrench, the mark a chat client puts on a tool it called. */
let WRENCH = h(
  'svg',
  { className: 'Chat_Icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
  h('path', {
    d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  }),
)

/** A terminal: the command typed after its prompt, and what it printed. */
let Term = (s: Shown) => [
  h('div', { className: 'Term_Bar' }, [
    h('i', { className: 'Term_Dot' }),
    h('i', { className: 'Term_Dot' }),
    h('i', { className: 'Term_Dot' }),
    h('span', { className: 'Term_Title' }, 'zsh'),
  ]),
  h('div', { className: 'Term_Screen' }, [
    h('div', { className: 'Term_In' }, [
      h('span', { className: 'Term_Sign' }, '$ '),
      s.line,
    ]),
    ...said(s),
  ]),
]

/** Your agent's chat: the tool it called, its arguments and what came back,
 * as a chat client shows a tool call. */
let Chat = (s: Shown) => {
  let { tool, args } = called(s.line)
  return [
    h('div', { className: 'Chat_Head' }, [
      h('span', { className: 'Chat_Face Chat_At', 'aria-hidden': 'true' }),
      h('b', { className: 'Chat_Name' }, 'Your agent'),
      h('span', { className: 'Chat_At' }, 'over MCP'),
    ]),
    h('div', { className: 'Chat_Call' }, [
      h('div', { className: 'Chat_Tool' }, [
        WRENCH,
        h('code', { className: 'Chat_Name' }, tool),
      ]),
      h(
        'dl',
        { className: 'Chat_Args' },
        Object.entries(args).flatMap(([k, v]) => [
          h('dt', { className: 'Chat_Key' }, k),
          h('dd', { className: 'Chat_Value' }, value(v)),
        ]),
      ),
      h('div', { className: 'Chat_Result' }, said(s)),
    ]),
    h(
      'div',
      { className: 'Chat_Say', 'aria-hidden': 'true' },
      'Reply to your agent',
    ),
  ]
}

/** The entity a page call changed, as the web canvas draws it: a task with
 * its box, a question with its choices, a comment under what it is on. */
let Drawn = (s: Shown, row: Bundle): ReactNode => {
  let head = (r: Bundle) =>
    h('div', { className: 'Page_Title' }, [
      r.task
        ? h('span', {
          className: `Page_Box${
            text(r, 'task', 'status') == 'done' ? ' is-on' : ''
          }`,
        })
        : null,
      h('span', { className: 'Page_Id' }, s.id(r.entity.eid)),
      h('b', { className: 'Page_Name' }, text(r, 'doc', 'title')),
    ])
  if (row.comment) {
    let on = s.find(text(row, 'comment', 'target'))
    return [
      on ? head(on) : null,
      h('div', { className: 'Page_Comment' }, [
        h(
          'span',
          { className: 'Page_Author' },
          s.id(text(row, 'created', 'by')),
        ),
        h('p', { className: 'Page_Text' }, text(row, 'doc', 'body')),
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
        { className: 'Page_Choices' },
        choices.map((c) =>
          h('li', {
            className: [c.label == chose ? 'is-on' : undefined, 'Page_Choice']
              .filter(Boolean).join(' '),
          }, c.label)
        ),
      )
      : h('div', { className: 'Page_State' }, text(row, 'task', 'status')),
  ]
}

/** The web canvas in a browser: the page at the address `yak serve` gives,
 * what the call changed drawn on it, and the call in its status line. */
let Page = (s: Shown) => [
  h('div', { className: 'Page_Bar' }, [
    h('span', { className: 'Page_Nav', 'aria-hidden': 'true' }, '← →'),
    h('span', { className: 'Page_Address' }, '127.0.0.1:8787'),
  ]),
  h('div', { className: 'Page_Body' }, s.row ? Drawn(s, s.row) : said(s)),
  h('div', { className: 'Page_Status' }, `called ${called(s.line).tool}`),
]

let field = (
  k: string,
  v: string,
) => [
  h('dt', { className: 'Letter_Key' }, k),
  h('dd', { className: 'Letter_Value' }, v),
]

/** What happened to a letter, a line each. */
let Happened = (s: Shown) =>
  h(
    'ol',
    { className: 'Letter_Tries', 'aria-label': 'What happened to it' },
    s.out.map((line) => h('li', null, line)),
  )

/** The letter the mail effect handed the mail service: from whom, to whom,
 * about what, its text as @yaks/inbox wrote it, and what happened to it. */
let Letter = (s: Shown) => {
  let r = s.row
  return [
    h('div', { className: 'Letter_Stamp', 'aria-hidden': 'true' }),
    h('dl', { className: 'Letter_Head' }, [
      ...r ? field('From', text(r, 'mail', 'from')) : [],
      ...r ? field('To', text(r, 'mail', 'to')) : [],
      ...field('Subject', r ? text(r, 'doc', 'title') : s.line),
    ]),
    r
      ? h(
        'div',
        { className: 'Letter_Body' },
        h(Prose, { source: text(r, 'doc', 'body') }),
      )
      : null,
    Happened(s),
  ]
}

/** Your reply to a letter, as it arrived: to the thread's address the letter
 * gave, about what, your words, and what it did. */
let Reply = (s: Shown) => {
  let [subject, words] = s.line.split('\n')
  let r = s.row
  return [
    h('dl', { className: 'Letter_Head' }, [
      ...field('To', r ? text(r, 'mail', 'to') : SHOP),
      ...field('Subject', r ? text(r, 'doc', 'title') : `Re: ${subject}`),
    ]),
    h('div', { className: 'Letter_Body' }, h('p', null, words)),
    Happened(s),
  ]
}

/** A new session's terminal UI: the persona it wears in its title bar, and
 * the context it starts with. */
let Session = (s: Shown) => [
  h('div', { className: 'Tui_Bar' }, [
    h('b', { className: 'Tui_Title' }, 'new session'),
    h('span', null, `wears ${s.line}`),
  ]),
  h(
    'div',
    { className: 'Tui_Screen' },
    s.out.map((line) =>
      h(
        'div',
        { className: line.startsWith('#') ? 'is-head' : undefined },
        line || ' ',
      )
    ),
  ),
  h('div', { className: 'Tui_Foot' }, [
    h('span', null, 'context'),
    h('span', null, `${s.out.filter((l) => l.startsWith('# ')).length} parts`),
  ]),
]

let LOOKS: Record<string, [string, (s: Shown) => ReactNode]> = {
  sh: ['Term', Term],
  mcp: ['Chat', Chat],
  web: ['Page', Page],
  outbox: ['Letter', Letter],
  reply: ['Letter', Reply],
  session: ['Tui', Session],
}

/** A door's window: its interface's look, by the door's kind. */
export let Look = (
  s: Shown & { className?: string; style?: Record<string, string | number> },
) => {
  let [look, draw] = LOOKS[s.kind] ?? LOOKS.sh
  return h('div', {
    className: `Window ${look}${s.className ? ` ${s.className}` : ''}`,
    'data-door': s.kind,
    style: s.style,
  }, draw(s))
}
