import { Scroll } from '@yaks/tui'
import { sessionTree } from './tree.ts'
/** Sidebar contributions: one graph read and one renderer, added as one row. */
import { type ComponentType, h } from 'preact'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Agent } from './run.ts'
import { indicator } from './status.ts'

/** The doors used by the UI; a test can supply just these. */
export type UIAgent =
  & Pick<
    Agent,
    | 'start'
    | 'send'
    | 'taskEntry'
    | 'sessions'
    | 'children'
    | 'tasks'
    | 'transcript'
    | 'line'
    | 'entry'
  >
  & Partial<Pick<Agent, 'archive'>>

/** The selection and graph doors handed to every panel. */
export type Context = {
  agent: UIAgent
  session?: Eid
  sessions: Bundle[]
  showSettled?: boolean
  showArchived?: boolean
  expanded?: string[]
}
/** A panel's data stays in bundles, not in a second model of the graph. */
export type Panel = {
  title: string
  titleClass?: string
  scrollable?: boolean
  read: (ctx: Context) => Bundle[] | Promise<Bundle[]>
  Render: ComponentType<Context & { rows: Bundle[] }>
}

/** Hide only completed delegated sessions; a selected child stays reachable. */
export let visibleSessions = (
  rows: Bundle[],
  session?: Eid,
  showSettled = false,
): Bundle[] =>
  rows.filter((b) =>
    showSettled || b.entity.eid == session || !b.spawned ||
    (b.session as Comp | undefined)?.status != 'settled'
  )

/** Compact generated identifiers without truncating meaningful session names. */
export let shortSessionId = (id: string): string =>
  id.replace(/^child:/, '').slice(0, 8)

export let sessionLine = (b: Bundle) => {
  let session = b.session as Comp
  let title = session.title || (b.doc as Comp | undefined)?.title
  let name = session.id && session.id != b.entity.eid ? String(session.id) : ''
  let label = title ? String(title) : name
  return label
    ? label + ' [' + shortSessionId(b.entity.eid) + ']'
    : shortSessionId(b.entity.eid)
}
let list = (
  rows: Bundle[],
  line: (b: Bundle) => import('preact').ComponentChildren,
  empty: string,
) =>
  h(
    'div',
    null,
    rows.length
      ? rows.map((b) => h('div', { key: b.entity.eid, wrap: '1' }, line(b)))
      : h('div', { class: 'Muted' }, empty),
  )

/** The stock sidebar. Add a contribution by adding one row to this list. */
export let panels: Panel[] = [
  {
    title: 'Sessions',
    scrollable: true,
    read: (c) => c.sessions,
    Render: ({ rows, session, showSettled, showArchived, expanded }) => {
      let tree = sessionTree(rows, {
        selected: session,
        showSettled,
        showArchived,
        expanded,
      })
      return h(
        Scroll,
        {
          id: 'session-tree',
          grow: '1',
          follow: false,
          keyboard: false,
          scrollbar: true,
          reveal: Math.max(
            0,
            tree.findIndex((r) => r.bundle.entity.eid == session) + 1,
          ),
        },
        h(
          'div',
          null,
          h(
            'div',
            { class: session ? 'Muted' : 'Title' },
            `${session ? '  ' : '> '}New session`,
          ),
          ...tree.map(({ bundle: b, depth, children, expanded: open }) =>
            h(
              'div',
              {
                key: b.entity.eid,
                class: session == b.entity.eid ? 'Title' : '',
              },
              session == b.entity.eid ? '> ' : '  ',
              '  '.repeat(depth),
              children ? (open ? '▾ ' : '▸ ') : '  ',
              indicator(b),
              ' ',
              sessionLine(b),
            )
          ),
        ),
      )
    },
  },
  {
    title: 'Context usage',
    read: (c) => c.session ? c.agent.transcript(c.session) : [],
    Render: ({ rows }) => {
      // Transcript order includes a fork's inherited prefix. Sequence numbers
      // alone need not be monotonic across that boundary; never sum requests.
      let usage = rows.findLast((b) => b.ask && b.usage)?.usage as
        | Comp
        | undefined
      let tokens = (value: unknown) =>
        typeof value == 'number' && Number.isFinite(value) && value >= 0
          ? String(value)
          : undefined
      let input = tokens(usage?.input_tokens)
      let output = tokens(usage?.output_tokens)
      let cached = tokens(usage?.cached_tokens)
      return h(
        'div',
        null,
        h(
          'div',
          { class: 'Muted', wrap: '1' },
          'Last reported request (not a live estimate)',
        ),
        h(
          'div',
          { wrap: '1' },
          input === undefined
            ? 'Input context: unavailable'
            : 'Input context: ' + input + ' tokens',
        ),
        output === undefined
          ? null
          : h('div', null, 'Output: ' + output + ' tokens'),
        cached === undefined
          ? null
          : h('div', null, 'Cached: ' + cached + ' tokens'),
      )
    },
  },
  {
    title: 'Tasks',
    titleClass: 'Task',
    read: (c) => c.agent.tasks(),
    Render: ({ rows, sessions }) =>
      list(rows, (b) => {
        let held = (b.claim as Comp | undefined)?.session
        return h(
          'span',
          null,
          indicator(b, sessions),
          ' ',
          `${b.entity.num ?? b.entity.eid.slice(0, 8)} ${
            (b.doc as Comp | undefined)?.title ?? b.entity.eid
          }${held ? ` [${shortSessionId(String(held))}]` : ''}`,
        )
      }, 'No open tasks'),
  },
  {
    title: 'Keys',
    read: () => [],
    Render: ({ showSettled, showArchived }) =>
      h(
        'div',
        null,
        ...[
          `^S        Show settled: ${showSettled ? 'on' : 'off'}`,
          'Ctrl+End  follow transcript end',
          '^N / ^P  next/previous root',
          'Alt+↑/↓   next/previous root',
          'Alt+v     VISUAL; Tab region; y yank',
          'Alt+j/k   next/previous tree row',
          'Alt+h/l   collapse/parent; expand/child',
          'Alt+a     archive/unarchive root',
          `Alt+z     Show archived: ${showArchived ? 'on' : 'off'}`,
          '^O        new session',
          'Tab       message / task',
          'Enter     submit',
          'Shift+Enter newline',
          'PgUp/PgDn scroll',
          '^C        quit',
        ].map((s) => h('div', null, s)),
      ),
  },
]
