/** Read stored span entities without adding inclusive parent metrics twice. */
import type { Bundle } from '@yaks/graph'
export let comp = (b: Bundle, name: string): Record<string, unknown> =>
  (b[name] ?? {}) as Record<string, unknown>
export let str = (v: unknown): string => v == null ? '' : String(v)
export let number = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined
export let metric = (b: Bundle, name: string): number | undefined =>
  number(comp(b, name)[name == 'elapsed' ? 'ms' : 'n'])
export let metrics = [
  'elapsed',
  'rows_read',
  'rows_written',
  'statements',
  'repeats',
] as const
export let labels: Record<string, string> = {
  elapsed: 'ms',
  rows_read: 'rows read',
  rows_written: 'rows written',
  statements: 'statements',
  repeats: 'suppressed repeats',
}
/// noun('elapsed') -> 'time'
/// noun('rows_read') -> 'rows read'
/** A measure as a sentence names it: "where the time went". */
export let noun = (axis: string): string =>
  axis == 'elapsed' ? 'time' : labels[axis]

export type Branch = { row: Bundle; children: Branch[]; orphan: boolean }
/** Each stored span appears once, including missing-parent and cyclic fragments. */
export let branches = (rows: Bundle[]): Branch[] => {
  let nodes = new Map(
    rows.map(
      (row) => [row.entity.eid, { row, children: [], orphan: false } as Branch],
    ),
  )
  let roots: Branch[] = []
  for (let node of nodes.values()) {
    let parent = str(comp(node.row, 'span').parent)
    let seen = new Set([node.row.entity.eid]), cursor = parent
    while (cursor && nodes.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = str(comp(nodes.get(cursor)!.row, 'span').parent)
    }
    if (parent && nodes.has(parent) && !seen.has(cursor)) {
      nodes.get(parent)!.children.push(node)
    } else {
      node.orphan = !!parent
      roots.push(node)
    }
  }
  let sort = (ns: Branch[]) => {
    ns.sort((a, b) =>
      (number(comp(a.row, 'elapsed').start) ?? 0) -
      (number(comp(b.row, 'elapsed').start) ?? 0)
    )
    ns.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}
/** Only true root spans contribute totals. A missing metric is not a zero. */
export let totals = (rows: Bundle[]): Record<string, number | undefined> => {
  let roots = rows.filter((b) => !comp(b, 'span').parent)
  return Object.fromEntries(metrics.map((name) => {
    let values = roots.map((b) => metric(b, name))
    return [
      name,
      values.length && values.every((v) => v != null)
        ? values.reduce<number>((a, v) => a + v!, 0)
        : undefined,
    ]
  }))
}
export let sameKind = (a: Bundle, b: Bundle): boolean =>
  ['op', 'name'].every((k) => comp(a, 'trace')[k] === comp(b, 'trace')[k]) &&
  ['space', 'app', 'entity', 'kind'].every((k) =>
    comp(a, 'during')[k] === comp(b, 'during')[k]
  )
export let ordinary = (rows: Bundle[]): boolean => {
  let t = totals(rows)
  return rows.length > 0 && branches(rows).every((n) => !n.orphan) &&
    t.rows_read != null && t.rows_written != null &&
    t.rows_read <= 10000 && t.rows_written <= 10000 &&
    (t.elapsed == null || t.elapsed <= 500) &&
    rows.every((b) => comp(b, 'span').outcome != 'error')
}
export let peers = (e: Bundle): string => {
  let clauses = [
    '.trace',
    ...['op', 'name'].map((k) =>
      `.trace.${k}=${JSON.stringify(comp(e, 'trace')[k])}`
    ),
  ]
  for (let k of ['space', 'app', 'entity', 'kind']) {
    let v = comp(e, 'during')[k]
    if (v != null) clauses.push(`.during.${k}=${JSON.stringify(v)}`)
  }
  return `${clauses.join(' ')} * .order=-trace.at .limit=100`
}
export let spans = (ids: string[]): string =>
  ids.length ? `.span.trace=${ids.join(',')} * .order=elapsed.start` : ''
export let format = (v: number | undefined): string =>
  v == null
    ? 'not recorded'
    : Number.isInteger(v)
    ? v.toLocaleString('en-US')
    : v.toFixed(2)

/** Sibling spans of one kind, summed: a rule's two hundred reads are one
 * `query read ×200`. Their children merge the same way, so a tree of
 * hundreds of statements reads as the dozen places its work went. */
export type Merged = {
  /** `op name plugin`, the same in any trace of this code */
  key: string
  op: string
  name: string
  plugin?: string
  spans: Bundle[]
  /** inclusive measurements, summed over the spans; absent if none had it */
  total: Record<string, number | undefined>
  /** what the spans measured outside their children */
  own: Record<string, number | undefined>
  error: boolean
  orphan: boolean
  children: Merged[]
}

let add = (a: number | undefined, b: number | undefined) =>
  a == null ? b : b == null ? a : a + b

/** Merge siblings that ran the same code, in the order each first started. */
export let merge = (ns: Branch[]): Merged[] => {
  let groups = new Map<string, Branch[]>()
  for (let n of ns) {
    let s = comp(n.row, 'span')
    let key = [s.op, s.name, s.plugin ?? ''].map(str).join(' ')
    groups.set(key, [...groups.get(key) ?? [], n])
  }
  return [...groups].map(([key, group]) => {
    let s = comp(group[0].row, 'span')
    let children = merge(group.flatMap((n) => n.children))
    let total = Object.fromEntries(metrics.map((m) => [
      m,
      group.reduce<number | undefined>(
        (a, n) => add(a, metric(n.row, m)),
        undefined,
      ),
    ]))
    let own = Object.fromEntries(metrics.map((m) => {
      let inner = children.reduce<number | undefined>(
        (a, c) => add(a, c.total[m]),
        undefined,
      )
      return [
        m,
        total[m] == null ? undefined : Math.max(0, total[m]! - (inner ?? 0)),
      ]
    }))
    return {
      key,
      op: str(s.op),
      name: str(s.name),
      plugin: s.plugin ? str(s.plugin) : undefined,
      spans: group.map((n) => n.row),
      total,
      own,
      error: group.some((n) => comp(n.row, 'span').outcome == 'error'),
      orphan: group.some((n) => n.orphan),
      children,
    }
  })
}

/// said({op: 'rule', name: 'task_ready'}) -> 'rule task_ready'
/// said({op: 'apply', name: 'apply'}) -> 'apply'
/** A place in the code as a person names it: what kind of work, and which. */
export let said = (n: { op: string; name: string }): string =>
  n.name && n.name != n.op ? `${n.op} ${n.name}` : n.op

/** A merged tree in reading order, each node with its depth, the places
 * above it, and its path of keys from the root, by which two traces of one
 * kind line up. */
export let walk = (
  ns: Merged[],
  up: Merged[] = [],
): { node: Merged; depth: number; path: string[]; up: Merged[] }[] =>
  ns.flatMap((node) => [
    { node, depth: up.length, path: [...up, node].map((n) => n.key), up },
    ...walk(node.children, [...up, node]),
  ])

/** One place two traces of a kind did different amounts of work. */
export type Difference = {
  path: string[]
  node: Merged
  /** the places above it, in the trace that has it */
  up: Merged[]
  mine?: number
  theirs?: number
  by: number
}

/** Where this trace's own work on `axis` differs most from the other's, place
 * by place, largest first. Own work, not inclusive, so a parent never
 * repeats the difference its child made. */
export let differences = (
  mine: Merged[],
  theirs: Merged[],
  axis: string,
): Difference[] => {
  let other = new Map(
    walk(theirs).map((w) => [w.path.join('\n'), w.node]),
  )
  let seen = new Set<string>()
  let out: Difference[] = []
  for (let w of walk(mine)) {
    let at = w.path.join('\n'), them = other.get(at)
    seen.add(at)
    let a = w.node.own[axis], b = them?.own[axis]
    if (a == null && b == null) continue
    out.push({
      path: w.path,
      node: w.node,
      up: w.up,
      mine: a,
      theirs: b,
      by: (a ?? 0) - (b ?? 0),
    })
  }
  for (let w of walk(theirs)) {
    let at = w.path.join('\n')
    if (seen.has(at) || w.node.own[axis] == null) continue
    out.push({
      path: w.path,
      node: w.node,
      up: w.up,
      theirs: w.node.own[axis],
      by: -w.node.own[axis]!,
    })
  }
  // Sums of a clock's fractions differ in their last bits: rounding, not work.
  let made = (d: Difference) =>
    Math.abs(d.by) > 1e-9 * Math.max(1, d.mine ?? 0, d.theirs ?? 0)
  return out.filter(made).sort((a, b) => Math.abs(b.by) - Math.abs(a.by))
}

/** The hue a kind of span wears, so a bar and its label agree everywhere:
 * the request, the graph's phases, rules, reads and statements. */
export let hue = (op: string): number =>
  ({
    request: 0,
    apply: 0,
    effect: 0,
    phase: 3,
    rule: 2,
    query: 1,
    get: 1,
    fanout: 1,
    sql: 4,
  } as Record<string, number>)[op] ?? 3

/** The measures a page can lay a trace out by; repeats count requests, not
 * work, and stay a fact of the root. */
export let axes = ['rows_read', 'elapsed', 'rows_written', 'statements']

/// figure('elapsed', 145.95) -> '146'
/// figure('elapsed', 0.65) -> '0.65'
/// figure('rows_read', 290029) -> '290,029'
/// figure('rows_read', undefined) -> '–'
/** A measurement's number alone, for a column that names its unit. */
export let figure = (axis: string, v: number | undefined): string =>
  v == null
    ? '–'
    : axis == 'elapsed' && v < 10
    ? String(Number(v.toPrecision(2)))
    : Math.round(v).toLocaleString('en-US')

/// amount('elapsed', 145.95) -> '146 ms'
/// amount('elapsed', 0.65) -> '0.65 ms'
/// amount('rows_read', 290029) -> '290,029 rows read'
/// amount('statements', 1) -> '1 statement'
/// amount('rows_read', undefined) -> 'rows read not recorded'
/** A measurement as a person reads it, with its unit. */
export let amount = (axis: string, v: number | undefined): string => {
  if (v == null) return `${labels[axis]} not recorded`
  if (axis == 'elapsed') return `${figure(axis, v)} ms`
  let unit = v == 1 && axis == 'statements' ? 'statement' : labels[axis]
  return `${figure(axis, v)} ${unit}`
}
