/** Trace queries and readings belong to timing. The inspector host supplies
 * held answers, navigation and page-graph state through its existing contract. */
import { h } from 'preact'
import { parse } from '@yaks/query'
import type { Bundle, Io, Props, View } from '@yaks/inspect'
import { inspectViews as baseViews } from '@yaks/inspect/views'
import { Button, Head, Rows, Section, Table, Value } from '@yaks/ui'
import {
  type Branch,
  branches,
  comp,
  format,
  labels,
  metrics,
  ordinary,
  peers,
  sameKind,
  spans,
  str,
  totals,
} from './readings.ts'
import { Flamegraph } from './Flamegraph.ts'

let status = (answer: Props['got'][string] | undefined) =>
  answer?.error
    ? h('p', { class: 'Section_Sub', role: 'alert' }, answer.error)
    : !answer?.ready
    ? h(
      'p',
      { class: 'Section_Sub', role: 'status' },
      'Loading recorded spans…',
    )
    : null
let ref = (io: Io, value: unknown) =>
  value
    ? io.show(
      io.get(str(value)) ?? { entity: { eid: str(value) } },
      'Inspect.Reference.Inline',
    )
    : 'not recorded'
let references = (rows: Bundle[]): string => {
  let ids = [
    ...new Set(
      rows.flatMap((e) =>
        Object.entries(comp(e, 'during')).filter(([k]) => k != 'kind').map((
          [, v],
        ) => str(v)).filter(Boolean)
      ),
    ),
  ]
  return ids.length ? `.entity.eid=${ids.join(',')} *` : ''
}
let context = (e: Bundle, io: Io) => {
  let d = comp(e, 'during')
  return h(
    Head.Facts,
    {},
    ...['entity', 'space', 'app', 'kind', 'process', 'request'].filter((k) =>
      d[k]
    ).map((k) =>
      h(
        'span',
        {},
        `${k == 'entity' ? 'store' : k} `,
        k == 'kind' ? str(d[k]) : ref(io, d[k]),
      )
    ),
  )
}
let summary = (t: Record<string, number | undefined>) =>
  metrics.map((n) =>
    h(
      'span',
      { key: n },
      h(Value, { mod: 'num' }, format(t[n])),
      ` ${labels[n]}`,
    )
  )
let TraceSummary = ({ e, io, got }: Props) =>
  h(
    'div',
    {},
    io.show(e, 'Timing.Trace.Tile'),
    status(got.spans),
    got.spans?.ready
      ? h(Head.Facts, {}, ...summary(totals(got.spans.rows)))
      : null,
  )
let state = (io: Io, id: string) =>
  comp(io.state(id) ?? { entity: { eid: id } }, 'table')
let axisControls = (io: Io, id: string, axis: string) =>
  h(
    'div',
    { class: 'Tabs', role: 'group', 'aria-label': 'Metric' },
    ...metrics.map((n) =>
      h(Button, {
        key: n,
        mod: axis == n ? 'on' : 'quiet',
        onClick: () => io.set([{ entity: { eid: id }, table: { order: n } }]),
        'aria-pressed': axis == n,
      }, labels[n])
    ),
  )
let axisOf = (io: Io, id: string): string => {
  let n = str(state(io, id).order)
  return metrics.includes(n as typeof metrics[number]) ? n : 'rows_read'
}
let SpanTree = ({ ns, io }: { ns: Branch[]; io: Io }) =>
  h(
    Rows,
    { mod: 'nested' },
    ...ns.map((n) =>
      h(
        Rows.Item,
        { key: n.row.entity.eid, id: `span-${n.row.entity.eid}` },
        io.show(n.row, 'Timing.Span'),
        n.orphan
          ? h(
            'p',
            { class: 'Section_Sub' },
            'Missing or cyclic parent; this is a fragment, not a complete root.',
          )
          : null,
        n.children.length ? h(SpanTree, { ns: n.children, io }) : null,
      )
    ),
  )
let TreePanel = (
  { e, rows, io, axis, title, extent }: {
    e: Bundle
    rows: Bundle[]
    io: Io
    axis: string
    title: string
    extent?: number
  },
) =>
  h(
    'section',
    { 'aria-label': title },
    h(Section.Title, {}, title),
    h(
      'p',
      { class: 'Section_Sub' },
      str(comp(e, 'trace').name),
      ' · ',
      io.when(str(comp(e, 'trace').at)),
    ),
    h(Head.Facts, {}, ...summary(totals(rows))),
    !rows.length
      ? h(
        'p',
        { class: 'Section_Sub' },
        'No span entities received. Delivery may be incomplete.',
      )
      : null,
    rows.length ? h(Flamegraph, { rows, axis, extent }) : null,
    h(SpanTree, { ns: branches(rows), io }),
  )
let Comparison = (
  { e, io, rows, axis }: { e: Bundle; io: Io; rows: Bundle[]; axis: string },
) => {
  let got = io.ask({ peers: peers(e) })
  let candidates = (got.peers?.rows ?? []).filter((b) =>
    b.entity.eid != e.entity.eid && sameKind(e, b)
  )
  let answer = io.ask({ spans: spans(candidates.map((b) => b.entity.eid)) })
  let candidate = candidates.find((b) =>
    ordinary(
      (answer.spans?.rows ?? []).filter((s) =>
        comp(s, 'span').trace == b.entity.eid
      ),
    )
  )
  let other = candidate
    ? (answer.spans?.rows ?? []).filter((s) =>
      comp(s, 'span').trace == candidate.entity.eid
    )
    : []
  let left = totals(rows), right = totals(other)
  let extent = Math.max(left[axis] ?? 0, right[axis] ?? 0)
  return h(
    Section,
    {},
    h(Section.Title, {}, 'Compare with an ordinary request'),
    status(got.peers) ?? (candidates.length ? status(answer.spans) : null),
    h(
      Section.Sub,
      {},
      'Same store/space/app and request kind/name. Ordinary candidates have recorded root counts ≤10,000 rows read and written, no error outcome, and at most 500 ms if time was measured. Recording reason is not stored: this is not proof of a random sample or a healthy request.',
    ),
    candidate
      ? h(
        'div',
        {},
        h(
          'p',
          {},
          'Ordinary candidate: ',
          io.show(candidate, 'Timing.Trace.Tile'),
        ),
        h(
          Table,
          { cols: [null, 'num', 'num', 'num'] },
          h(
            Table.Head,
            {},
            h(
              Table.Row,
              {},
              ...['Metric', 'Selected', 'Ordinary', 'Difference'].map((t) =>
                h(Table.Heading, {}, t)
              ),
            ),
          ),
          h(
            Table.Body,
            {},
            ...metrics.map((n) =>
              h(
                Table.Row,
                { key: n },
                h(Table.Cell, {}, labels[n]),
                h(Table.Cell, { mod: 'num' }, format(left[n])),
                h(Table.Cell, { mod: 'num' }, format(right[n])),
                h(
                  Table.Cell,
                  { mod: 'num' },
                  left[n] != null && right[n] != null
                    ? format(left[n]! - right[n]!)
                    : 'not recorded',
                ),
              )
            ),
          ),
        ),
        h(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))',
              gap: '1.5rem',
            },
          },
          h(TreePanel, { e, rows, axis, io, extent, title: 'Selected trace' }),
          h(TreePanel, {
            e: candidate,
            rows: other,
            axis,
            io,
            extent,
            title: 'Ordinary trace',
          }),
        ),
      )
      : h(
        'p',
        { class: 'Section_Sub' },
        'No ordinary candidate with the same context in the latest 100 matching traces. No comparison is fabricated.',
      ),
    !candidate
      ? h(TreePanel, { e, rows, axis, io, title: 'Selected trace' })
      : null,
  )
}
let TracePage = ({ e, io, got }: Props) => {
  io.ask({ references: references([e]) })
  let rows = got.spans?.rows ?? [],
    t = comp(e, 'trace'),
    id = `timing-axis:${e.entity.eid}`,
    axis = axisOf(io, id)
  return h(
    'article',
    {
      class: 'Body',
      style: { maxWidth: 'none', width: '100%' },
      'data-trace': e.entity.eid,
    },
    h(
      'nav',
      {},
      h('a', { href: io.find('.bug.status=open * .order=-bug.hits') }, 'Bugs'),
      ' · ',
      h('a', { href: io.find('.trace') }, 'Traces'),
    ),
    h(
      Head,
      {},
      h(Head.Title, {}, `${str(t.op)} · ${str(t.name)}`),
      h(Head.Sub, {}, io.when(str(t.at))),
      context(e, io),
    ),
    h(
      Section.Sub,
      {},
      'Metrics are inclusive: parent spans include their children. Totals use root spans only; missing measurements are not zero. Span delivery has no completion marker; missing parents are shown as fragments.',
    ),
    axisControls(io, id, axis),
    status(got.spans),
    got.spans?.ready ? h(Comparison, { e, io, rows, axis }) : null,
  )
}
let groupKey = (b: Bundle) => {
  let d = comp(b, 'during'), t = comp(b, 'trace')
  return JSON.stringify([d.space, d.entity, d.app, d.kind, t.op, t.name])
}
let TraceList = ({ io, query }: { io: Io; query: string }) => {
  let id = `timing-list:${query}`, axis = axisOf(io, id)
  let line = query.includes('*') ? query : `${query} *`
  // A bounded recent window is explicit; sorting is by root metrics, not the
  // sum of inclusive span rows and not a hidden server-wide aggregate.
  let got = io.ask({
    traces: `${line} .order=-trace.at .limit=200`,
    count: `${line} .count`,
  })
  let traces = got.traces?.rows ?? []
  io.ask({ references: references(traces) })
  let root = io.ask({
    roots: traces.length
      ? `${spans(traces.map((t) => t.entity.eid))} !span.parent`
      : '',
  })
  let measured = (e: Bundle) =>
    totals(
      (root.roots?.rows ?? []).filter((r) =>
        comp(r, 'span').trace == e.entity.eid
      ),
    )
  let score = (e: Bundle) => measured(e)[axis] ?? -1
  let groups = new Map<string, Bundle[]>()
  for (let t of traces) {
    let k = groupKey(t)
    groups.set(k, [...(groups.get(k) ?? []), t])
  }
  let ordered = [...groups.values()].map((g) =>
    g.sort((a, b) => score(b) - score(a))
  ).sort((a, b) => score(b[0]) - score(a[0]))
  return h(
    'article',
    { class: 'Body', 'data-trace-list': true },
    h(
      'nav',
      {},
      h('a', { href: io.find('.bug.status=open * .order=-bug.hits') }, 'Bugs'),
      ' · ',
      h('a', { href: io.find('.trace') }, 'Traces'),
    ),
    h(
      Head,
      {},
      h(Head.Title, {}, 'Traces · worst first'),
      h(
        Head.Sub,
        {},
        `${traces.length} recent traces shown${
          got.count?.count != null ? ' of ' + got.count.count : ''
        }. Groups and traces ranked by inclusive root ${
          labels[axis]
        }; unmeasured roots last. Window: latest 200. Narrow by store or request with the query box.`,
      ),
    ),
    axisControls(io, id, axis),
    status(got.traces),
    traces.length ? status(root.roots) : null,
    !traces.length && got.traces?.ready
      ? h('p', {}, 'No recorded traces match this query.')
      : null,
    ...ordered.map((g) =>
      h(
        Section,
        { key: groupKey(g[0]) },
        h(
          Section.Title,
          {},
          `${str(comp(g[0], 'trace').op)} · ${str(comp(g[0], 'trace').name)}`,
          h(Section.Count, {}, g.length),
        ),
        context(g[0], io),
        h(
          Rows,
          {},
          ...g.map((e) =>
            h(
              Rows.Item,
              { key: e.entity.eid },
              io.show(e, 'Timing.Trace.Tile'),
              h(Head.Facts, {}, ...summary(measured(e))),
            )
          ),
        ),
      )
    ),
  )
}
export let inspectViews: View[] = [
  ...['Full', 'Page', 'Inspect.Full', 'Inspect.Page'].map((view) => ({
    view,
    match: parse('.trace'),
    asks: (e: Bundle) => ({ spans: spans([e.entity.eid]) }),
    Render: TracePage,
  })),
  ...['List.Tile', 'Tile'].map((view) => ({
    view,
    match: parse('.trace'),
    asks: (e: Bundle) => ({ spans: `${spans([e.entity.eid])} !span.parent` }),
    Render: TraceSummary,
  })),
  {
    view: 'Inspect.Query',
    match: parse(".entity.eid~='browse-query:'"),
    Render: (props) => {
      let query = str(props.ctx.query)
      return /(^|[\s&(|])\.trace(?:[.\s&)|]|$)/.test(query)
        ? h(TraceList, { io: props.io, query })
        : h(baseViews.find((v) => v.view == 'Inspect.Query')!.Render, props)
    },
  },
]
