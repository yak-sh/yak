import { Time } from '@yaks/ui/parts'
// The admin's Spending page (T-151607): where the platform's dollars went
// over the last thirty days. Each day's dollars, by what sold them and by who
// covered them, come from the directory's space rows (`trend`, meter.ts
// `trended`); what each conversation, helper and piece of a request cost
// comes from the rows each space's Operator records for its model requests
// (operator-spending.ts). Nothing is estimated past what those rows say;
// where they keep nothing for a range, the page says which.
//
// It only draws: admin.ts reads the rows and puts this on its desk.
import { type ComponentChildren, Fragment, h, type VNode } from 'preact'
import { Card, type Col, Empty, Group, Table } from '@yaks/ui/parts'
import { type ByDay, columns, series, sparkline, summed } from '@yaks/ui/chart'
import { count, dollars, SOURCES } from './meter.ts'
import { day } from './html.ts'
import {
  joined,
  none,
  type Part,
  plus,
  type Ran,
  type Run,
  type Spending,
} from './operator-spending.ts'

/** A space as the page counts it. */
export type Counted = {
  eid: string
  slug: string
  /** every person seated in it is a test account */
  test: boolean
  /** it pays for its plan */
  paying: boolean
  /** what it spent this month */
  month: number
  trend?: { spend?: ByDay; sources?: Record<string, ByDay>; paid?: ByDay }
}

/** What a space's Operator answered, or what kept it from answering. */
export type Asked = { space: Counted; spending: Spending | Error }

let DAYS = 30
let DAY = 86_400_000
let SHOWN = 100
// The newest helpers listed under each conversation; the rest are one line.
let HELPERS = 5
let TOP = 10

let total = (byDay: ByDay | undefined, now: number, days = DAYS) =>
  series(byDay, days, now).values.reduce((a, b) => a + b, 0)

let tokens = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e4
    ? `${Math.round(n / 1e3)}k`
    : count(Math.round(n))

let lasted = (ms: number) => {
  let s = Math.round(ms / 1000)
  return s < 60
    ? `${s}s`
    : s < 3600
    ? `${Math.floor(s / 60)}m ${s % 60}s`
    : `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`
}

let pct = (n: number, of: number) => of ? `${Math.round(n / of * 100)}%` : '0%'

// A table: its headings over its rows, a column of numbers set right.
let table = (
  cols: Col[],
  heads: string[],
  rows: VNode[],
) =>
  h(
    Card,
    { as: 'div', class: 'Spending_Table' },
    h(
      Table,
      { cols },
      h(
        Table.Head,
        null,
        h(
          Table.Row,
          null,
          heads.map((said, i) =>
            h(Table.Heading, { mod: cols[i] == 'num' && 'num' }, said)
          ),
        ),
      ),
      h(Table.Body, null, rows),
    ),
  )
let row = (
  first: ComponentChildren,
  nums: ComponentChildren[],
  mod?: string,
) =>
  h(
    Table.Row,
    { mod },
    h(Table.Cell, null, first),
    nums.map((n) => h(Table.Cell, { mod: 'num' }, n)),
  )
let indented = (said: ComponentChildren) =>
  h(Fragment, null, h(Table.Indent, null), said)

let facts = (all: [string, string][]) =>
  h(
    Card,
    { as: 'div' },
    h(
      'dl',
      { class: 'Fields Directory_Facts' },
      all.map(([say, n]) =>
        h('div', null, h('dt', null, say), h('dd', null, n))
      ),
    ),
  )
let note = (said: ComponentChildren) => h('p', { class: 'Spending_Note' }, said)
let section = (title: string, ...body: ComponentChildren[]) =>
  h(Fragment, null, h(Group, null, title), ...body)

// The first day any of these maps holds.
let firstOf = (maps: (ByDay | undefined)[]) =>
  maps.flatMap((m) => Object.keys(m ?? {})).sort()[0] ?? null

// ---- each day ---------------------------------------------------------------

// Each source's dollars over the window: the last 30 and 7 days, today, and
// the line of its days.
let bySource = (byDay: Record<string, ByDay>, now: number) =>
  Object.entries(byDay)
    .map(([source, days]) => ({ source, days, n: total(days, now) }))
    .filter((s) => s.n)
    .sort((a, b) => b.n - a.n)
    .map(({ source, days, n }) =>
      row(SOURCES[source] ?? source, [
        dollars(n),
        dollars(total(days, now, 7)),
        dollars(total(days, now, 1)),
        sparkline(h as never, {
          ...series(days, DAYS, now),
          money: true,
        }) as VNode,
      ])
    )

let daily = (spaces: Counted[], asked: Asked[], now: number) => {
  let spend = summed(spaces.map((s) => s.trend?.spend))
  let sources: Record<string, ByDay> = {}
  for (let s of spaces) {
    for (let [k, v] of Object.entries(s.trend?.sources ?? {})) {
      sources[k] = summed([sources[k], v])
    }
  }
  let since = firstOf(Object.values(sources))
  let shown = (day: string) => !!since && day >= since
  let recorded = Object.entries(spend).filter(([d]) => shown(d))
    .reduce((a, [, n]) => a + n, 0)
  let paid = Object.entries(summed(spaces.map((s) => s.trend?.paid)))
    .filter(([d]) => shown(d) && d >= ymd(now - (DAYS - 1) * DAY))
    .reduce((a, [, n]) => a + n, 0)
  let operator: Record<string, ByDay> = {}
  for (let a of asked) {
    if (a.spending instanceof Error) continue
    for (let [d, by] of Object.entries(a.spending.days)) {
      for (let [p, n] of Object.entries(by)) {
        operator[p] = summed([operator[p], { [d]: n }])
      }
    }
  }
  let heads = ['', '30 days', '7 days', 'Today', 'Each day']
  let cols: Col[] = [null, 'num', 'num', 'num', null]
  return section(
    'Each day',
    facts([
      ['Spent in 30 days', dollars(total(spend, now))],
      ['Spent this month', dollars(spaces.reduce((a, s) => a + s.month, 0))],
      ...since
        ? [
          [
            `Covered by paying plans since ${day(since)}`,
            `${dollars(paid)} of ${dollars(recorded)} (${pct(paid, recorded)})`,
          ],
          [
            'Given by the platform',
            `${dollars(recorded - paid)} (${pct(recorded - paid, recorded)})`,
          ],
        ] as [string, string][]
        : [],
    ]),
    h(
      Card,
      { as: 'div' },
      columns(h as never, { ...series(spend, DAYS, now), money: true }),
    ),
    since
      ? table(cols, ['By source', ...heads.slice(1)], bySource(sources, now))
      : null,
    note(
      since
        ? `By source and by who covered it since ${
          day(since)
        }; before that each day's total alone was recorded.`
        : "Each day's dollars by source and by who covered them are recorded from this deploy on; before it only each day's total was.",
    ),
    Object.keys(operator).length
      ? table(
        cols,
        ['The Operator’s model calls', ...heads.slice(1)],
        bySource(operator, now),
      )
      : null,
  )
}

let ymd = (t: number) => new Date(t).toISOString().slice(0, 10)

// ---- spaces and conversations ------------------------------------------------

let link = (href: string, said: string) => h('a', { href }, said)

let topSpaces = (spaces: Counted[], base: string, now: number) => {
  let top = spaces
    .map((s) => ({ s, n: total(s.trend?.spend, now) }))
    .filter((t) => t.n)
    .sort((a, b) => b.n - a.n)
    .slice(0, TOP)
  return top.length
    ? table(
      [null, null, 'num', 'num'],
      ['Space', 'Plan', '30 days', 'This month'],
      top.map(({ s, n }) =>
        h(
          Table.Row,
          null,
          h(Table.Cell, null, link(`${base}/${s.eid}`, s.slug)),
          h(
            Table.Cell,
            null,
            s.test ? 'Test' : s.paying ? 'Paying' : 'Given',
          ),
          h(Table.Cell, { mod: 'num' }, dollars(n)),
          h(Table.Cell, { mod: 'num' }, dollars(s.month)),
        )
      ),
    )
    : null
}

type Placed = Run & { space: Counted }

let runsOf = (asked: Asked[]): Placed[] =>
  asked.flatMap((a) =>
    a.spending instanceof Error
      ? []
      : a.spending.runs.map((r) => ({ ...r, space: a.space }))
  )

let opens = (base: string, r: { space: Counted; open: string }) =>
  `${base}/${r.space.eid}/operator/${r.open}`

let used = (u: Ran) => [
  dollars(u.cost),
  count(u.turns),
  tokens(u.input),
  tokens(u.cached),
  tokens(u.output),
  lasted(u.ms),
]
let USED = ['Cost', 'Requests', 'Input', 'Cached', 'Output', 'Wall time']

let topRuns = (runs: Placed[], base: string) => {
  let top = [...runs].sort((a, b) => b.cost - a.cost).slice(0, TOP)
  return top.length
    ? table(
      [null, null, 'num', 'num', 'num'],
      ['Conversation', 'Space', 'Cost', 'Requests', 'Helpers'],
      top.map((r) =>
        h(
          Table.Row,
          null,
          h(Table.Cell, null, link(opens(base, r), r.title)),
          h(Table.Cell, null, r.space.slug),
          h(Table.Cell, { mod: 'num' }, dollars(r.cost)),
          h(Table.Cell, { mod: 'num' }, count(r.turns)),
          h(Table.Cell, { mod: 'num' }, count(r.helpers.length)),
        )
      ),
    )
    : null
}

// Every conversation and task, newest first, each with its helpers under it.
let sessions = (runs: Placed[], base: string) => {
  let shown = [...runs].sort((a, b) => b.until.localeCompare(a.until))
    .slice(0, SHOWN)
  let cols: Col[] = [
    null,
    null,
    'num',
    'num',
    'num',
    'num',
    'num',
    'num',
    null,
  ]
  let line = (
    r: Ran & { space: Counted },
    first: ComponentChildren,
    mod?: string,
  ) =>
    h(
      Table.Row,
      { mod },
      h(Table.Cell, null, first),
      h(Table.Cell, null, r.space.slug),
      used(r).map((n) => h(Table.Cell, { mod: 'num' }, n)),
      h(Table.Cell, null, h(Time, { at: r.until })),
    )
  return shown.length
    ? table(
      cols,
      ['Conversation or helper', 'Space', ...USED, 'Last'],
      shown.flatMap((r) => [
        line(r, link(opens(base, r), r.title)),
        ...r.helpers.slice(0, HELPERS).map((helper) =>
          line(
            { ...helper, space: r.space },
            indented(
              link(opens(base, { ...helper, space: r.space }), helper.title),
            ),
            'quiet',
          )
        ),
        ...r.helpers.length > HELPERS
          ? [line(
            {
              ...r.helpers.slice(HELPERS).reduce(plus, none()),
              open: '',
              title: '',
              space: r.space,
            },
            indented(`${count(r.helpers.length - HELPERS)} more helpers`),
            'quiet',
          )]
          : [],
      ]),
    )
    : h(Empty, null, h('h2', null, 'No Operator has spent anything yet'))
}

// ---- what each request carries -------------------------------------------------

// What a piece is called on the page, and the group it is listed under.
let NAMES: Record<string, string> = {
  system: 'The harness’s system prompt',
  instructions: 'Instructions',
  skills: 'Skills',
  fixed: 'Not split (its session recorded no pieces)',
  input: 'What people typed',
  output: 'What the model said',
  reasoning: 'Reasoning',
  notice: 'Notices',
  checkpoint: 'Checkpoints',
}
let groupOf = (piece: string) =>
  piece.startsWith('tool ')
    ? 'The tool list'
    : piece.startsWith('persona ')
    ? 'The persona'
    : piece.startsWith('call ')
    ? 'Tool calls'
    : piece.startsWith('result ')
    ? 'Tool results'
    : piece
let nameOf = (piece: string) =>
  NAMES[piece] ?? piece.replace(/^(tool|persona|call|result) /, '')

let merged = (all: Record<string, Part>[]) => {
  let out: Record<string, Part> = {}
  for (let parts of all) {
    for (let [k, p] of Object.entries(parts)) {
      out[k] = out[k] ? joined(out[k], p) : p
    }
  }
  return out
}
// A group's pieces as one: every request that carries the group carries
// each of them, so it was carried as often as its most carried piece.
let grouped = (all: Part[]) => ({
  ...all.reduce(joined),
  sends: Math.max(...all.map((p) => p.sends)),
})
let costOf = (p: Part) => p.cached + p.written + p.uncached
let sentOf = (p: Part) => p.read + p.write + p.fresh + p.generated

// A piece's line: tokens a request, how many carried it, its dollars read
// from the provider's cache, written to it and sent fresh, and what that
// comes to a month at this rate.
let partLine = (
  said: ComponentChildren,
  p: Part,
  month: number,
  mod?: string,
) =>
  row(said, [
    tokens(sentOf(p) / Math.max(1, p.sends)),
    count(p.sends),
    dollars(p.cached),
    dollars(p.written),
    dollars(p.uncached),
    dollars(costOf(p) * month),
  ], mod)

// The pieces, a group a line by what they cost, each group's pieces under it
// where it has more than one.
let partsTable = (
  title: string,
  parts: Record<string, Part>,
  month: number,
) => {
  let groups = new Map<string, [string, Part][]>()
  for (let [k, p] of Object.entries(parts)) {
    groups.set(groupOf(k), [...groups.get(groupOf(k)) ?? [], [k, p]])
  }
  let lines = [...groups].map(([group, all]) => ({
    group,
    all: all.sort((a, b) => costOf(b[1]) - costOf(a[1])),
    sum: grouped(all.map(([, p]) => p)),
  })).sort((a, b) => costOf(b.sum) - costOf(a.sum))
  return table(
    [null, 'num', 'num', 'num', 'num', 'num', 'num'],
    [
      title,
      'Tokens a request',
      'Requests',
      'Cache reads',
      'Cache writes',
      'Uncached',
      'A month',
    ],
    lines.flatMap(({ group, all, sum }) =>
      all.length == 1 ? [partLine(nameOf(all[0][0]), all[0][1], month)] : [
        partLine(`${nameOf(group)} (${all.length})`, sum, month),
        ...all.slice(0, 25).map(([k, p]) =>
          partLine(indented(nameOf(k)), p, month, 'quiet')
        ),
      ]
    ),
  )
}

let carried = (asked: Asked[], now: number) => {
  let read = asked.flatMap((a) =>
    a.spending instanceof Error ? [] : [a.spending]
  )
  let prompt = merged(read.map((s) => s.prompt))
  let rest = merged(read.map((s) => s.rest))
  let split = read.map((s) => s.split).filter((s): s is string => !!s).sort()[0]
  if (!split) {
    return section(
      'What each request carries',
      note('No Operator has recorded where its tokens went yet.'),
    )
  }
  // The days the split covers, and what a month is of them.
  let days = Math.min(DAYS, Math.max(1, (now - Date.parse(split)) / DAY))
  let month = DAYS / days
  let fixed = Object.entries(prompt)
  let all = grouped(fixed.map(([, p]) => p))
  let tools = fixed.filter(([k]) => k.startsWith('tool '))
  let each = (p: Part) => sentOf(p) / Math.max(1, all.sends)
  return section(
    'What each request carries',
    facts([
      [
        'Before its conversation, a request carries',
        `${tokens(each(all))} tokens`,
      ],
      [
        'Of them, the tool list',
        tools.length
          ? `${tokens(each(grouped(tools.map(([, p]) => p))))} tokens`
          : 'none',
      ],
      [
        `That part cost, in ${count(Math.round(days))} ${
          Math.round(days) == 1 ? 'day' : 'days'
        }`,
        `${dollars(costOf(all))}, about ${
          dollars(costOf(all) * month)
        } a month`,
      ],
      ['Read from the provider’s cache', pct(all.read, sentOf(all))],
    ]),
    partsTable('The fixed part', prompt, month),
    partsTable('The rest of each request', rest, month),
    note(
      `Where each request's tokens went is kept 30 days, and recorded from ${
        day(split)
      }. The provider reports each request's totals; the fixed part is shared among its pieces by their sizes.`,
    ),
  )
}

/** The page's body: each day, the top spaces, the top conversations, every
 * conversation and helper, and what each request carries. */
export let spendingBody = (
  spaces: Counted[],
  asked: Asked[],
  base: string,
  now = Date.now(),
): VNode => {
  let runs = runsOf(asked)
  let unread = asked.filter((a) => a.spending instanceof Error)
  return h(
    Fragment,
    null,
    daily(spaces, asked, now),
    section('Top spaces', topSpaces(spaces, base, now)),
    section('Top conversations', topRuns(runs, base)),
    section('Conversations and helpers, newest first', sessions(runs, base)),
    carried(asked, now),
    unread.length
      ? section(
        'Could not be read',
        h(
          Card,
          { as: 'ul', class: 'Directory' },
          unread.map((a) =>
            h(
              'li',
              null,
              `${a.space.slug}: ${(a.spending as Error).message}`,
            )
          ),
        ),
      )
      : null,
  )
}
