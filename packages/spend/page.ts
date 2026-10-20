/**
 * Where the tokens went, as the browsing app draws it: the plan limits
 * against their pace, then a span's tally (the Claude plan's week by
 * default, beside the week before it) by part of the context, session, task,
 * large entry and model. A day's row is the same tally for its day. Every
 * number comes from the `spend` rows the duty keeps (./service.ts); nothing
 * here reads a request. Rows a tally names are drawn by name through the
 * shared renderers.
 *
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import { mention, type Props, useNamed, type View } from '@yaks/inspect'
import { Head, Loading, Meter, Section, Table } from '@yaks/ui'
import { merged, ranked, type Spend, spendOf } from './tally.ts'
import { current, type Limit, limitsOf, paceOf, span } from './window.ts'
import { dollars, tokens } from './words.ts'

let { Body, Cell, Heading, Row } = Table
let TOP = 15

let sum = (ns: number[]) => ns.slice(0, 4).reduce((a, b) => a + b, 0)
let back = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * 864e5).toISOString()
    .slice(0, 10)

let waiting = (got: Props['got'][string] | undefined, what: string) =>
  got?.error
    ? h(Section.Sub, { role: 'alert' }, got.error)
    : !got?.ready
    ? h(Loading, {}, `Loading ${what}…`)
    : null

// A plan limit and its pace, on one line.
let Limits = ({ limits, now }: { limits: Limit[]; now: number }) =>
  h(
    Section,
    {},
    h(Section.Title, {}, 'Plan limits'),
    h(
      Section.Sub,
      {},
      'Each bar is what is used; the mark is how much of its window is gone, which is what an even spend would have used by now.',
    ),
    h(
      Table,
      { cols: ['key', null, 'prose'] },
      h(
        Body,
        {},
        limits.filter((l) => current(l, now)).map((l) => {
          let pace = paceOf(l, now)
          return h(
            Row,
            { key: `${l.provider} ${l.window}` },
            h(
              Cell,
              { mod: 'key' },
              `${l.provider} ${l.window == 10080 ? 'week' : 'five hours'}`,
            ),
            h(Cell, {}, h(Meter, { value: l.used / 100, mark: pace })),
            h(
              Cell,
              { mod: 'prose' },
              `${Math.round(l.used)}% used, ${
                Math.round(pace * 100)
              }% of it gone${
                l.resets
                  ? `, resets ${l.resets.slice(0, 16).replace('T', ' ')} UTC`
                  : ''
              }`,
            ),
          )
        }),
      ),
    ),
  )

// A ranking: each row's name, a bar of its share of the costliest, its
// dollars and what else the caller says about it.
let Ranking = (
  { title, sub, rows, at, name, more, heads }: {
    title: string
    sub: string
    rows: [string, number[]][]
    at: number
    name: (key: string) => ComponentChildren
    more: (ns: number[], key: string) => string[]
    heads: string[]
  },
) => {
  let most = rows[0]?.[1][at] || 1
  return h(
    Section,
    {},
    h(Section.Title, {}, title, ' ', h(Section.Count, {}, String(rows.length))),
    h(Section.Sub, {}, sub),
    h(
      Table,
      { cols: [null, null, 'num', ...heads.map(() => 'num')] },
      h(
        Table.Head,
        {},
        h(
          Row,
          {},
          h(Heading, {}, ''),
          h(Heading, {}, ''),
          h(Heading, { mod: ['num', 'desc'] }, 'dollars'),
          ...heads.map((k) => h(Heading, { key: k, mod: 'num' }, k)),
        ),
      ),
      h(
        Body,
        {},
        rows.map(([k, ns]) =>
          h(
            Row,
            { key: k },
            h(Cell, {}, name(k)),
            h(Cell, {}, h(Meter, { value: ns[at] / most, width: 10 })),
            h(Cell, { mod: 'num' }, dollars(ns[at])),
            ...more(ns, k).map((s, i) => h(Cell, { key: i, mod: 'num' }, s)),
          )
        ),
      ),
    ),
  )
}

/** A tally, ranked, beside an earlier one to read it against. */
let Breakdown = (
  { io, s, before }: { io: Props['io']; s: Spend; before?: Spend },
) => {
  let top = <T>(rows: T[]) => rows.slice(0, TOP)
  let sessions = top(ranked(s.sessions, 1))
  let tasks = top(ranked(s.tasks, 1))
  let entries = top(ranked(s.entries, 1)).slice(0, 10)
  let models = ranked(s.models, 4)
  useNamed(io, [...sessions, ...tasks, ...entries, ...models].map(([k]) => k))
  let named = (k: string) => k ? mention(io, k) : h('span', {}, 'none')
  let was = (k: string) => before ? [dollars(before.parts[k]?.[4] ?? 0)] : []
  return h(
    'div',
    {},
    h(Ranking, {
      title: 'What the context was made of',
      sub:
        'Each part of what the requests carried, at what it cost as it was paid: read from the cache, written to it, sent fresh, or generated. A part is paid for on every request it rides in. The totals are measured; the split across parts is estimated from their sizes.',
      rows: ranked(s.parts, 4).slice(0, 30),
      at: 4,
      name: (k) => h('span', {}, k),
      more: (ns, k) => [
        tokens(ns[0]),
        tokens(ns[1]),
        tokens(ns[2]),
        tokens(ns[3]),
        ...was(k),
      ],
      heads: [
        'read',
        'written',
        'fresh',
        'generated',
        ...before ? ['week before'] : [],
      ],
    }),
    h(Ranking, {
      title: 'Sessions',
      sub:
        'Each session by what its requests cost; a subagent is a session of its own.',
      rows: sessions,
      at: 1,
      name: named,
      more: (ns) => [String(ns[2]), tokens(ns[0])],
      heads: ['requests', 'tokens'],
    }),
    h(Ranking, {
      title: 'Tasks',
      sub:
        'Each session split evenly across the tasks it claimed, commented on, filed or finished, and a subagent across the tasks its brief names, else as the session that started it.',
      rows: tasks,
      at: 1,
      name: named,
      more: (ns) => [tokens(ns[0])],
      heads: ['tokens'],
    }),
    h(Ranking, {
      title: 'Entries carried most',
      sub:
        'What one entry of a transcript cost as it was carried, request after request.',
      rows: entries,
      at: 1,
      name: named,
      more: (ns) => [tokens(ns[0])],
      heads: ['tokens'],
    }),
    h(Ranking, {
      title: 'Models',
      sub:
        'At the price the provider reported, else at the model’s list price.',
      rows: models,
      at: 4,
      name: named,
      more: (ns) => [String(ns[5]), tokens(sum(ns))],
      heads: ['requests', 'tokens'],
    }),
  )
}

let facts = (s: Spend) => [
  dollars(s.dollars),
  `${s.requests.toLocaleString('en-US')} requests`,
  `${tokens(sum(s.tokens))} tokens`,
]

/** The page: the limits, then the span the Claude week covers, beside the
 * week before. */
export let Page = ({ io, got }: Props): JSX.Element => {
  let now = Date.now()
  let names = new Map(
    (got.providers?.rows ?? []).map((b) => [
      b.entity.eid,
      String((b.provider as { name?: unknown }).name ?? ''),
    ]),
  )
  let limits = limitsOf(got.limits?.rows ?? [], names)
  let days = (got.days?.rows ?? []).map(spendOf).filter((s): s is Spend => !!s)
  let [from, to] = span(limits, now)
  let length = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1
  let within = (a: string, b: string) =>
    days.filter((d) => d.day >= a && d.day <= b)
  let week = merged(within(from, to))
  let before = merged(within(back(from, 7), back(from, 1)))
  return h(
    'article',
    {},
    h(
      Head,
      {},
      h(Head.Title, {}, 'Where the tokens went'),
      h(
        Head.Sub,
        {},
        `${from} to ${to}, the ${length} UTC days of this Claude plan week, beside the week before. Tallied from every model request every ten minutes.`,
      ),
      h(
        Head.Facts,
        {},
        ...facts(week),
        `the week before ${dollars(before.dollars)}`,
      ),
    ),
    waiting(got.limits, 'the plan limits') ?? h(Limits, { limits, now }),
    waiting(got.days, 'the tallies') ??
      h(Breakdown, { io, s: week, before }),
  )
}

/** A day's page: its tally. */
export let DayPage = ({ e, io }: Props): JSX.Element => {
  let s = spendOf(e)
  return h(
    'article',
    {},
    h(
      Head,
      {},
      h(Head.Title, {}, `Where the tokens went on ${s?.day ?? ''}`),
      h(Head.Sub, {}, 'One UTC day, tallied from its model requests.'),
      s ? h(Head.Facts, {}, ...facts(s)) : null,
    ),
    s ? h(Breakdown, { io, s }) : null,
  )
}

/** The views this package draws in the browsing app. */
export let inspectViews: View[] = [
  {
    view: 'Spend.Page',
    match: true,
    asks: () => ({
      days: '.spend * .order=-spend.day .limit=21',
      limits: '.rate_limit *',
      providers: '.provider *',
    }),
    Render: Page,
  },
  { view: 'Full', match: parse('.spend'), Render: DayPage },
]
