/** Sidebar contributions: one graph read and one renderer, added as one row. */
import { type ComponentType, h } from 'preact'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Agent } from './run.ts'

/** The doors used by the UI; a test can supply just these. */
export type UIAgent = Pick<
  Agent,
  | 'start'
  | 'send'
  | 'taskEntry'
  | 'sessions'
  | 'children'
  | 'tasks'
  | 'transcript'
  | 'line'
>

/** The selection and graph doors handed to every panel. */
export type Context = { agent: UIAgent; session?: Eid; sessions: Bundle[] }
/** A panel's data stays in bundles, not in a second model of the graph. */
export type Panel = {
  title: string
  read: (ctx: Context) => Bundle[] | Promise<Bundle[]>
  Render: ComponentType<Context & { rows: Bundle[] }>
}

let sessionLine = (b: Bundle) => {
  let s = b.session as Comp
  return `${s.id ?? b.entity.eid.slice(0, 8)}  ${s.status ?? 'pending'}`
}
let list = (rows: Bundle[], line: (b: Bundle) => string, empty: string) =>
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
    read: (c) => c.sessions,
    Render: ({ rows, session }) =>
      h(
        'div',
        null,
        h(
          'div',
          { class: session ? 'Muted' : 'Title' },
          `${session ? '  ' : '> '}New session`,
        ),
        ...rows.map((b) =>
          h('div', {
            key: b.entity.eid,
            class: session == b.entity.eid ? 'Title' : '',
            wrap: '1',
          }, `${session == b.entity.eid ? '> ' : '  '}${sessionLine(b)}`)
        ),
      ),
  },
  {
    title: 'Subagents',
    read: (c) => c.session ? c.agent.children(c.session) : [],
    Render: ({ rows }) => list(rows, sessionLine, 'No subagents'),
  },
  {
    title: 'Tasks',
    read: (c) => c.agent.tasks(),
    Render: ({ rows }) =>
      list(rows, (b) => {
        let held = (b.claim as Comp | undefined)?.session
        return `${b.entity.num ?? ''} ${(b.task as Comp).status ?? 'open'} ${
          (b.doc as Comp | undefined)?.title ?? b.entity.eid
        }${held ? ` [${String(held).slice(0, 8)}]` : ''}`
      }, 'No open tasks'),
  },
  {
    title: 'Keys',
    read: () => [],
    Render: () =>
      h(
        'div',
        null,
        ...[
          '^N / ^P  select session',
          'Alt+↑/↓   select session',
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
