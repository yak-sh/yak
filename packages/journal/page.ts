/**
 * What history keeps, as the browsing app draws it: its share of the file
 * and what it kept per change and per day, day by day; the changes the
 * journal holds for each component, beside what that component keeps in its
 * own table and its versions; and every table in the file, largest first.
 * Everything comes from the `kept` rows the duty writes once a day
 * (./service.ts), the changes per component among them, so opening the page
 * reads a month of rows and counts nothing. A component is drawn by name and
 * opens its page, where its recent writes are.
 *
 * @module
 */
import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import { identityEid } from '@yaks/graph/identity'
import { mention, type Props, useNamed, type View } from '@yaks/inspect'
import { Head, Loading, Meter, Section, Table } from '@yaks/ui'
import { size } from '@yaks/file'
import {
  changes,
  historic,
  history,
  type Kept,
  keptOf,
  perChange,
  perDay,
  versioned,
} from './kept.ts'

let { Body, Cell, Heading, Row } = Table
let COMPONENTS = 30
let TABLES = 40

let count = (n: number) => Math.round(n).toLocaleString('en-US')
let share = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : ''

type Answer = Props['got'][string] | undefined

let waiting = (got: Answer, what: string) =>
  got?.error
    ? h(Section.Sub, { role: 'alert' }, got.error)
    : !got?.ready
    ? h(Loading, {}, `Loading ${what}…`)
    : null

// A table of rows under headings: the first column a name, the second a bar.
let Ranked = (
  { title, sub, heads, rows }: {
    title: string
    sub: string
    heads: string[]
    rows: {
      key: string
      name: ComponentChildren
      bar: number
      cells: string[]
    }[]
  },
) =>
  h(
    Section,
    {},
    h(Section.Title, {}, title, ' ', h(Section.Count, {}, String(rows.length))),
    h(Section.Sub, {}, sub),
    h(
      Table,
      { cols: [null, null, ...heads.map(() => 'num')] },
      h(
        Table.Head,
        {},
        h(
          Row,
          {},
          h(Heading, {}, ''),
          h(Heading, {}, ''),
          ...heads.map((k) => h(Heading, { key: k, mod: 'num' }, k)),
        ),
      ),
      h(
        Body,
        {},
        rows.map((r) =>
          h(
            Row,
            { key: r.key },
            h(Cell, {}, r.name),
            h(Cell, {}, h(Meter, { value: r.bar, width: 10 })),
            ...r.cells.map((s, i) => h(Cell, { key: i, mod: 'num' }, s)),
          )
        ),
      ),
    ),
  )

// Each day, newest first, beside the day before it.
let Days = ({ days }: { days: Kept[] }) =>
  h(Ranked, {
    title: 'Day by day',
    sub:
      'The file and what history kept in it each day, the changes the journal held, and what history kept per change written since the day before.',
    heads: ['file', 'history', 'changes', 'per change'],
    rows: days.map((k, i) => {
      let before = days[i + 1]
      let each = before && perChange(before, k)
      return {
        key: k.day,
        name: k.day,
        bar: k.bytes ? history(k) / k.bytes : 0,
        cells: [
          size(k.bytes),
          `${size(history(k))} (${share(history(k), k.bytes)})`,
          count(changes(k)),
          each == null ? '' : size(each),
        ],
      }
    }),
  })

// The changes the journal held for each component, beside what the
// component keeps in its table and its versions.
let Components = ({ io, k }: { io: Props['io']; k: Kept }) => {
  let rows = io.vocab.all.map((c) => ({
    c,
    eid: identityEid('_comp', [c]),
    n: k.changes?.[c] ?? 0,
  })).filter((r) => r.n || k.tables[`${r.c}$versions`])
    .toSorted((a, b) => b.n - a.n).slice(0, COMPONENTS)
  useNamed(io, rows.map((r) => r.eid))
  let most = rows[0]?.n || 1
  return h(Ranked, {
    title: 'By component',
    sub:
      'The changes the journal held for each component, and what the component keeps in its own table and in its versions. A component marked as keeping no history has none.',
    heads: ['changes', 'table', 'versions'],
    rows: rows.map(({ c, eid, n }) => ({
      key: c,
      name: mention(io, eid),
      bar: n / most,
      cells: [
        count(n),
        size(k.tables[c]?.[0]),
        k.tables[`${c}$versions`] ? size(k.tables[`${c}$versions`][0]) : '',
      ],
    })),
  })
}

// Every table, largest first, with its growth a day.
let Tables = ({ k, before }: { k: Kept; before?: Kept }) => {
  let rows = Object.entries(k.tables).toSorted(([, a], [, b]) => b[0] - a[0])
    .slice(0, TABLES)
  let most = rows[0]?.[1][0] || 1
  let grew = (t: string) => {
    let d = before && perDay(before, k, (m) => m.tables[t]?.[0] ?? 0)
    return d == null ? '' : `${d > 0 ? '+' : ''}${size(d)}`
  }
  return h(Ranked, {
    title: 'Tables',
    sub:
      'Every table in the file with its indexes, largest first. History’s are the journal’s and each component’s versions.',
    heads: ['bytes', 'rows', 'a day', ''],
    rows: rows.map(([t, [bytes, n]]) => ({
      key: t,
      name: versioned(t) ? `${versioned(t)} versions` : t,
      bar: bytes / most,
      cells: [size(bytes), count(n), grew(t), historic(t) ? 'history' : ''],
    })),
  })
}

/** The page: history's share of the file, day by day, by component and by
 * table. */
export let Page = ({ io, got }: Props): JSX.Element => {
  let days = (got.days?.rows ?? []).map(keptOf).filter((k): k is Kept => !!k)
  let [k, before] = days
  let each = before && perChange(before, k)
  let daily = before && perDay(before, k, history)
  return h(
    'article',
    {},
    h(
      Head,
      {},
      h(Head.Title, {}, 'What history keeps'),
      h(
        Head.Sub,
        {},
        'The journal records who wrote what and the values each write left; versions keep every version of a row. Measured once a day from the file’s pages, each table with its indexes.',
      ),
      k
        ? h(
          Head.Facts,
          {},
          `${size(history(k))} of the file’s ${size(k.bytes)} (${
            share(history(k), k.bytes)
          })`,
          ...daily == null ? [] : [`${size(daily)} more a day`],
          ...each == null ? [] : [`${size(each)} kept per change`],
          `${count(changes(k))} changes held`,
          `measured ${io.when(k.at)}`,
        )
        : null,
    ),
    waiting(got.days, 'the measurements') ?? (!k
      ? h(
        Section.Sub,
        {},
        'Not measured yet: the duty measures the file once a day.',
      )
      : h(
        Fragment,
        {},
        h(Days, { days: days.slice(0, 14) }),
        h(Components, { io, k }),
        h(Tables, { k, before }),
      )),
  )
}

/** The views this package draws in the browsing app. */
export let inspectViews: View[] = [
  {
    view: 'History.Page',
    match: true,
    asks: () => ({ days: '.kept * .order=-kept.day .limit=31' }),
    Render: Page,
  },
]
