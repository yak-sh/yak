/** A trace's page and the trace list, as the inspector draws them: where a
 * request's time and rows went, place by place in the code (phases, rules,
 * reads, statements), beside an ordinary request of the same kind in the same
 * store; and every recorded kind of request, its worst first. Queries belong
 * here; the host answers them, names references and keeps the page's state.
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import {
  type Bundle,
  type Io,
  mention,
  type Props,
  useNamed,
  type View,
} from '@yaks/inspect'
import { inspectViews as baseViews } from '@yaks/inspect/views'
import { Head, Section, Tabs, Tile } from '@yaks/ui'
import { Disclosure, disclosureAt, isOpen } from '@yaks/ux'
import {
  amount,
  axes,
  branches,
  comp,
  differences,
  figure,
  labels,
  merge,
  type Merged,
  noun,
  ordinary,
  peers,
  sameKind,
  spans,
  str,
  totals,
  walk,
} from './readings.ts'
import { Flamegraph } from './Flamegraph.ts'
import { Gaps, Line, list, Places } from './Places.ts'
import {
  address,
  remoteAnswers,
  Scope,
  Side,
  type Tree,
  tree,
} from './remote.ts'
import { useEffect, useState } from 'preact/hooks'
import { Button } from '@yaks/ui'

let CONTEXT = ['entity', 'space', 'app', 'process', 'request']
let WORST = 5

let status = (answer: Props['got'][string] | undefined, what: string) =>
  answer?.error
    ? h(Section.Sub, { role: 'alert' }, answer.error)
    : !answer?.ready
    ? h(Section.Sub, { role: 'status' }, `Reading ${what}…`)
    : null

/** Where a trace ran, by name: the store, space and app its context names. */
let Where = ({ io, e }: { io: Io; e: Bundle }): JSX.Element | null => {
  let d = comp(e, 'during')
  let keys = CONTEXT.filter((k) => d[k])
  useNamed(io, keys.map((k) => str(d[k])))
  if (!keys.length && !d.kind) return null
  return h(
    'span',
    {},
    keys.map((k, i) => [
      i ? ' · ' : '',
      `${k == 'entity' ? 'store' : k} `,
      mention(io, str(d[k])),
    ]),
    d.kind ? `${keys.length ? ' · ' : ''}${str(d.kind)}` : null,
  )
}

/** The measure a page lays traces out by, kept in the page's graph. */
let axisOf = (io: Io, id: string, fallback = 'rows_read'): string => {
  let held = io.state(id)
  let order = held ? str(comp(held, 'table').order) : ''
  return axes.includes(order) ? order : fallback
}
let lay = (io: Io, id: string, axis: string) =>
  io.set([{ entity: { eid: id }, table: { order: axis } }])

let Measures = ({ io, id, axis }: { io: Io; id: string; axis: string }) =>
  h(
    Tabs,
    { role: 'group', 'aria-label': 'Lay out by' },
    axes.map((a) =>
      h(Tabs.Tab, {
        key: a,
        type: 'button',
        mod: a == axis && 'on',
        'aria-pressed': a == axis,
        onClick: () => lay(io, id, a),
      }, labels[a])
    ),
  )

/** Press a bar to find its row in the table of places. */
let finder = (paths: Map<string, number>, id: (i: number) => string) =>
(
  path: string[],
) => {
  let i = paths.get(path.join('\n'))
  if (i == null) return
  globalThis.document?.getElementById?.(id(i))?.scrollIntoView?.({
    block: 'center',
  })
}

/** The newest ordinary trace of the same kind in the same store, and where
 * this one's work differs from it. Ordinary: its root read and wrote at most
 * ten thousand rows, took at most half a second where time was measured, and
 * failed nowhere. */
let Beside = (
  { e, io, roots, axis }: {
    e: Bundle
    io: Io
    roots: Merged[]
    axis: string
  },
): JSX.Element => {
  let t = comp(e, 'trace')
  let found = io.ask({ peers: peers(e) })
  let others = (found.peers?.rows ?? []).filter((b) =>
    b.entity.eid != e.entity.eid && sameKind(b, e)
  )
  let tops = io.ask({
    tops: others.length
      ? `${spans(others.map((b) => b.entity.eid))} !span.parent`
      : '',
  })
  let peer = others.find((b) =>
    (tops.tops?.rows ?? []).some((r) =>
      comp(r, 'span').trace == b.entity.eid && ordinary([r])
    )
  )
  let theirs = io.ask({ theirs: peer ? spans([peer.entity.eid]) : '' })
  let rows = theirs.theirs?.rows ?? []
  let them = merge(branches(rows))
  let a = roots.reduce((s, r) => s + (r.total[axis] ?? 0), 0)
  let b = them.reduce((s, r) => s + (r.total[axis] ?? 0), 0)
  let diffs = differences(roots, them, axis).slice(0, 8)
  let title = h(
    Section.Title,
    {},
    `Beside an ordinary ${str(t.name)}`,
    peer
      ? h(
        Section.Note,
        {},
        h('a', { href: io.link(peer.entity.eid) }, io.id(peer)),
      )
      : null,
  )
  if (found.peers?.error || tops.tops?.error) {
    return h(
      Section,
      {},
      title,
      status(found.peers?.error ? found.peers : tops.tops, 'comparison'),
    )
  }
  if (!found.peers?.ready || (others.length && !tops.tops?.ready)) {
    return h(Section, {}, title, status(undefined, 'traces of this kind'))
  }
  if (!peer) {
    return h(
      Section,
      {},
      title,
      h(
        Section.Sub,
        {},
        `No ordinary ${
          str(t.name)
        } in this store among its latest hundred traces: none read and wrote at most 10,000 rows, took at most 500 ms and failed nowhere.`,
      ),
    )
  }
  return h(
    Section,
    {},
    title,
    h(
      Section.Sub,
      {},
      `Recorded ${io.when(str(comp(peer, 'trace').at))} in the same store. `,
      `This one: ${amount(axis, a)}; the ordinary one: ${amount(axis, b)}`,
      a && b ? `, ${ratio(a, b)}.` : '.',
    ),
    status(theirs.theirs, 'its spans') ??
      [
        diffs.length ? h(Gaps, { gaps: diffs, axis }) : h(
          Section.Sub,
          {},
          `They spent the same ${noun(axis)} in the same places.`,
        ),
        h(
          Section.Sub,
          {},
          `The ordinary one, at its own scale (${amount(axis, b)}):`,
        ),
        h(Flamegraph, { roots: them, axis }),
      ],
  )
}

let count = (v?: number) =>
  v == null ? '–' : Math.round(v).toLocaleString('en-US')

/// ratio(290029, 149) -> '1,947× as many'
/// ratio(10, 20) -> 'half as many'
/// ratio(12, 10) -> '1.2× as many'
/** How many times one amount is another, said plainly. */
export let ratio = (a: number, b: number): string =>
  a == b
    ? 'as many'
    : a < b
    ? (a / b == 0.5 ? 'half as many' : `${count(b / a)}× fewer`)
    : `${a / b < 10 ? Number((a / b).toPrecision(2)) : count(a / b)}× as many`

let TracePage = (
  { e, io, got, side = 'box' }: Props & { side?: string },
): JSX.Element => {
  let t = comp(e, 'trace'), rows = got.spans?.rows ?? []
  let roots = merge(branches(rows))
  let all = totals(rows)
  let state = `timing-axis:${e.entity.eid}`
  let axis = axisOf(
    io,
    state,
    all.rows_read || !all.elapsed ? 'rows_read' : 'elapsed',
  )
  let ids = (i: number) => `place-${i}`
  let paths = new Map(walk(roots).map((w, i) => [w.path.join('\n'), i]))
  let repeats = all.repeats
  return h(
    'article',
    { 'data-trace': e.entity.eid },
    h(
      Head,
      {},
      h(
        Head.Title,
        {},
        str(t.name),
        h(Head.Id, {}, io.id(e)),
        h(Head.Kind, {}, str(t.op)),
      ),
      h(
        Head.Sub,
        {},
        side,
        ' · ',
        h(Where, { io, e }),
      ),
      h(
        Head.Facts,
        {},
        h(
          'time',
          { datetime: str(t.at), title: str(t.at) },
          io.when(str(t.at)),
        ),
        ...got.spans?.ready ? axes.map((a) => amount(a, all[a])) : [],
        repeats
          ? `${count(repeats)} more like it went unrecorded within the hour`
          : null,
      ),
    ),
    h(Measures, { io, id: state, axis }),
    h(
      Section,
      {},
      h(
        Section.Title,
        {},
        `Where the ${noun(axis)} went`,
        h(Section.Count, {}, amount(axis, all[axis])),
      ),
      status(got.spans, 'its spans') ?? (
        !rows.length
          ? h(Section.Sub, {}, 'No span of this trace was received.')
          : !all[axis]
          ? h(
            Section.Sub,
            {},
            axis == 'elapsed'
              ? "Its clock did not move: a Worker's clock stands still while it computes. The rows read show where its work went."
              : `It recorded no ${noun(axis)}.`,
          )
          : [
            h(Flamegraph, { roots, axis, pick: finder(paths, ids) }),
            h(
              Section.Sub,
              {},
              `Each bar is a place in the code, as wide as the ${
                noun(axis)
              } there and in what it called, which hangs under it; siblings that ran the same code are one bar. Press a bar to find it below.`,
            ),
          ]
      ),
    ),
    // Beside a trace that recorded none of the measure, any other differs
    // only by what it recorded.
    got.spans?.ready && all[axis] ? h(Beside, { e, io, roots, axis }) : null,
    rows.length
      ? h(
        Section,
        {},
        h(
          Section.Title,
          {},
          'Places',
          h(Section.Count, {}, `${rows.length} spans`),
        ),
        roots.some((r) => r.orphan)
          ? h(
            Section.Sub,
            {},
            'Some spans name a parent that never arrived; they stand at the top.',
          )
          : null,
        h(Places, { roots, axis, id: ids }),
      )
      : null,
  )
}

/** A trace in a list: what it was, when, and what its root measured. */
let TraceTile = ({ e, io, got }: Props): JSX.Element => {
  let t = comp(e, 'trace'), root = got.root?.rows ?? []
  let all = totals(root)
  return h(
    Tile,
    { href: io.link(e.entity.eid) },
    h(Tile.Id, {}, io.id(e)),
    h(Tile.Title, {}, `${str(t.name)}`),
    h(Tile.Kind, {}, str(t.op)),
    h(
      Tile.Sub,
      {},
      [
        'box',
        io.when(str(t.at)),
        ...root.length ? axes.map((a) => amount(a, all[a])) : [],
      ].join(' · '),
    ),
  )
}

let kindOf = (b: Bundle) => {
  let d = comp(b, 'during'), t = comp(b, 'trace')
  return JSON.stringify([d.space, d.entity, d.app, d.kind, t.op, t.name])
}

/** Content a press opens, its state kept in the page's graph under `at`. */
let More = (
  { io, at, summary, children }: {
    io: Io
    at: string
    summary: ComponentChildren
    children?: ComponentChildren
  },
): JSX.Element => {
  let eid = disclosureAt(at), e = io.state(eid) ?? { entity: { eid } }
  return h(Disclosure, {
    e,
    onChange: (b: Bundle) => io.set([b]),
    summary: [isOpen(e) ? '▾ ' : '▸ ', summary],
    summaryProps: { mod: 'quiet' },
  }, children)
}

/** Traces of one kind as lines, worst first: when each was recorded and
 * what its root measured, the measure they are ordered by marked in its
 * heading. The worst few show; the rest are a press away. */
let Measured = (
  { io, at, traces, measured, axis }: {
    io: Io
    at: string
    traces: Bundle[]
    measured: Map<string, Record<string, number | undefined>>
    axis: string
  },
): JSX.Element => {
  let line = (b: Bundle) => {
    let m = measured.get(b.entity.eid) ?? {}, moment = str(comp(b, 'trace').at)
    return h(Line, {
      key: b.entity.eid,
      label: h(
        'a',
        { href: io.link(b.entity.eid), title: moment },
        io.when(moment),
      ),
      cells: axes.map((a) => figure(a, m[a])),
    })
  }
  let shown = traces.length > WORST + 1 ? traces.slice(0, WORST) : traces
  let rest = traces.slice(shown.length)
  return h(
    'div',
    {},
    h(
      'ul',
      { style: list },
      h(Line, {
        head: true,
        label: 'when',
        cells: axes.map((a) =>
          h('span', {
            style: a == axis ? { color: 'var(--accent)' } : undefined,
          }, labels[a])
        ),
      }),
      shown.map(line),
    ),
    rest.length
      ? h(
        More,
        { io, at, summary: `${rest.length} more of this kind` },
        h('ul', { style: list }, rest.map(line)),
      )
      : null,
  )
}

/** Every recorded kind of request in each store, worst first on the measure
 * chosen, each trace a row of its root's measurements. */
export let TraceList = (
  { io, query, side = 'box' }: { io: Io; query: string; side?: string },
): JSX.Element => {
  let state = `timing-list:${query}`, axis = axisOf(io, state)
  let line = query.includes('*') ? query : `${query} *`
  let got = io.ask({
    traces: `${line} .order=-trace.at .limit=200`,
    count: `${line} .count`,
  })
  let traces = got.traces?.rows ?? []
  let tops = io.ask({
    tops: traces.length
      ? `${spans(traces.map((t) => t.entity.eid))} !span.parent`
      : '',
  })
  let measured = new Map(
    traces.map((t) => [
      t.entity.eid,
      totals(
        (tops.tops?.rows ?? []).filter((r) =>
          comp(r, 'span').trace == t.entity.eid
        ),
      ),
    ]),
  )
  let score = (b: Bundle) => measured.get(b.entity.eid)?.[axis] ?? -1
  let groups = new Map<string, Bundle[]>()
  for (let t of traces) {
    groups.set(kindOf(t), [...groups.get(kindOf(t)) ?? [], t])
  }
  let ordered = [...groups.values()]
    .map((g) => g.sort((a, b) => score(b) - score(a)))
    .sort((a, b) => score(b[0]) - score(a[0]))
  let total = got.count?.count
  return h(
    'article',
    { 'data-trace-list': true },
    h(Side, { remote: side == 'yaks.app' }),
    h(
      Head,
      {},
      h(Head.Title, {}, 'Traces'),
      h(Head.Sub, {}, side),
      h(
        Head.Sub,
        {},
        total != null && total > traces.length
          ? `The latest ${traces.length} of ${count(total)} recorded traces, `
          : `${count(traces.length)} recorded traces, `,
        `each kind of request in a store together, the most ${
          noun(axis)
        } first.`,
      ),
    ),
    h(Measures, { io, id: state, axis }),
    status(got.traces, 'traces'),
    traces.length ? status(tops.tops, 'root measurements') : null,
    !traces.length && got.traces?.ready
      ? h(Section.Sub, {}, 'No recorded trace matches this query.')
      : null,
    ordered.map((g) => {
      let t = comp(g[0], 'trace')
      return h(
        Section,
        { key: kindOf(g[0]) },
        h(
          Section.Title,
          {},
          str(t.name),
          h(Section.Note, {}, str(t.op)),
          h(
            Section.Count,
            {},
            g.length == 1 ? '1 trace' : `${g.length} traces`,
          ),
        ),
        h(Section.Sub, {}, h(Where, { io, e: g[0] })),
        h(Measured, {
          io,
          at: `${state}:${kindOf(g[0])}`,
          traces: g,
          measured,
          axis,
        }),
      )
    }),
  )
}

/** Remote data uses these very same views; only their read and link doors
 * change. Nothing is admitted to the box or page's durable graph. */
let Remote = (
  { io, params }: { io: Io; params: URLSearchParams },
): JSX.Element => {
  let scope = params.get('scope') || 'platform', eid = params.get('trace') || ''
  let after = params.get('after') || ''
  let [page, setPage] = useState<
    { rows: Bundle[]; next?: string; error?: string }
  >()
  useEffect(() => {
    let abort = new AbortController()
    let q = new URLSearchParams({
      scope,
      limit: '100',
      ...after ? { after } : {},
    })
    void fetch(`/tracker/traces?${q}`, { signal: abort.signal }).then(
      async (r) => {
        let p = await r.json()
        if (!r.ok) throw Error(p.error || 'Remote traces unavailable')
        if (!abort.signal.aborted) setPage(p)
      },
    ).catch((e) => {
      if (!abort.signal.aborted) setPage({ rows: [], error: e.message })
    })
    return () => abort.abort()
  }, [scope, after])
  let remoteIo: Io = {
    ...io,
    link: (id) => address(scope, id),
    ask: (asks) => remoteAnswers(io, scope, asks),
  }
  // The list answer is the selected Worker page. Its root measurements and
  // comparison asks still use the same shared query evaluator.
  let listIo: Io = {
    ...remoteIo,
    ask: (asks) => {
      let rest = Object.fromEntries(
        Object.entries(asks).filter(([k]) => k != 'traces' && k != 'count'),
      )
      let got = remoteAnswers(io, scope, rest)
      return {
        ...got,
        ...'traces' in asks
          ? {
            traces: {
              rows: page?.rows ?? [],
              ready: !!page && !page.error,
              error: page?.error,
            },
          }
          : {},
        ...'count' in asks ? { count: { rows: [], ready: !!page } } : {},
      }
    },
  }
  let [selected, setSelected] = useState<
    { key: string; tree?: Tree; error?: string }
  >()
  let selectedKey = `${scope}:${eid}`
  useEffect(() => {
    let abort = new AbortController()
    if (eid) {
      void tree(scope, eid, abort.signal).then((t) => {
        if (!abort.signal.aborted) setSelected({ key: selectedKey, tree: t })
      }).catch((e) => {
        if (!abort.signal.aborted) {
          setSelected({ key: selectedKey, error: e.message })
        }
      })
    }
    return () => abort.abort()
  }, [scope, eid])
  let held = selected?.key == selectedKey ? selected : undefined
  let answer = {
    rows: held?.tree?.spans ?? [],
    ready: !!held?.tree,
    error: held?.error,
  }
  return h(
    'div',
    {},
    h(Scope, { scope }),
    eid
      ? [
        h(Side, { remote: true }),
        h('a', { href: address(scope) }, 'All traces in this scope'),
        status(answer, 'remote trace'),
        held?.tree
          ? h(TracePage, {
            e: held.tree.trace,
            io: remoteIo,
            ctx: {},
            side: 'yaks.app',
            got: {
              spans: answer,
            },
          })
          : null,
      ]
      : [
        h(TraceList, { io: listIo, query: '.trace', side: 'yaks.app' }),
        page?.next
          ? h(
            Button,
            { href: address(scope, undefined, page.next) },
            'Older traces',
          )
          : null,
        after ? h(Button, { href: address(scope) }, 'Newest traces') : null,
      ],
  )
}

/** The pages this package draws in the inspector. */
export let inspectViews: View[] = [
  {
    view: 'Full',
    match: parse('.trace'),
    asks: (e: Bundle) => ({ spans: spans([e.entity.eid]) }),
    Render: TracePage,
  },
  ...['List.Tile', 'Tile'].map((view) => ({
    view,
    match: parse('.trace'),
    asks: (e: Bundle) => ({ root: `${spans([e.entity.eid])} !span.parent` }),
    Render: TraceTile,
  })),
  {
    view: 'Inspect.Query',
    match: parse(".entity.eid~='browse-query:'"),
    Render: (props) => {
      let query = str(props.ctx.query)
      let params = typeof location == 'undefined'
        ? new URLSearchParams()
        : new URLSearchParams(location.search)
      if (params.get('side') == 'yaks.app') {
        return h(Remote, { io: props.io, params })
      }
      return /(^|[\s&(|])\.trace(?:[.\s&)|]|$)/.test(query)
        ? h(TraceList, { io: props.io, query })
        : h(baseViews.find((v) => v.view == 'Inspect.Query')!.Render, props)
    },
  },
]
