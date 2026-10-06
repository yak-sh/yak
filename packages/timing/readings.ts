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
