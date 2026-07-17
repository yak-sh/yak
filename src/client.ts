// The headless client half — what the CLI and the MCP server share. Talks
// to a running tasks server over HTTP (/snapshot to read, /apply to
// write; writes broadcast to every live client), assembles entities the
// same way live.ts does, and owns the dot-param grammar:
//   .title=Hello        routes by prop — title lives only in doc
//   .doc.title=Hello    the explicit spelling, for collisions (pin/camera
//                       geometry) or clarity
// Values that look like numbers become numbers.
import { type Change, comps, type Dep, kindOf, statuses } from './types.ts'

export let host = () => Deno.env.get('TASKS_HOST') ?? '127.0.0.1:5173'

export type Row = {
  eid: string
  num: number
  kind: string
  comps: Record<string, Record<string, unknown>>
}

export let snapshot = async () => {
  let res = await fetch(`http://${host()}/snapshot`)
  if (!res.ok) throw new Error(`server said ${res.status}`)
  return res.json() as Promise<{ changes: Change[]; deps: Dep[] }>
}

// The graph as rows: one per entity, components merged in; kind derived.
export let rows = ({ changes }: { changes: Change[] }) => {
  let out = new Map<string, Row>()
  for (let { eid, name, comp } of changes) {
    if (!comp) continue
    let row = out.get(eid) ??
      { eid, num: 0, kind: 'entity', comps: {} }
    if (name == 'entity') row.num = Number(comp.num ?? 0)
    else row.comps[name] = comp
    out.set(eid, row)
  }
  for (let r of out.values()) r.kind = kindOf(r.comps)
  return [...out.values()]
}

export let send = async (changes: Change[]) => {
  let res = await fetch(`http://${host()}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  if (!res.ok) throw new Error(`apply failed: ${await res.text()}`)
}

// ---- dot-params ----

export type Param = { comp: string; prop: string; value: unknown }

// Route a bare prop to its component; ambiguity is an error that names
// the candidates rather than a guess.
let routeProp = (prop: string): string => {
  let hits = Object.entries(comps)
    .filter(([, cols]) => cols.includes(prop))
    .map(([name]) => name)
  if (hits.length == 1) return hits[0]
  if (!hits.length) throw new Error(`unknown prop: .${prop}`)
  throw new Error(
    `.${prop} is ambiguous (${hits.join(', ')}) — use .${hits[0]}.${prop}`,
  )
}

let coerce = (v: string): unknown => /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v

// '.title=Hello' | '.doc.title=Hello' → {comp, prop, value}; null if the
// argument isn't a dot-param at all (a bare word).
export let param = (arg: string): Param | null => {
  let m = arg.match(/^\.([A-Za-z_]+)(?:\.([A-Za-z_]+))?=(.*)$/s)
  if (!m) return null
  let [, a, b, raw] = m
  let value = coerce(raw)
  if (b) {
    if (!comps[a]?.includes(b)) {
      throw new Error(`no such prop: .${a}.${b}`)
    }
    return { comp: a, prop: b, value }
  }
  return { comp: routeProp(a), prop: a, value }
}

// Group routed params into per-component patches.
export let patches = (params: Param[]) => {
  let out: Record<string, Record<string, unknown>> = {}
  for (let { comp, prop, value } of params) {
    ;(out[comp] ??= {})[prop] = value
  }
  return out
}

// Resolve 'T-3' / a bare num / an eid to a row.
export let find = (all: Row[], id: string) => {
  let m = id.match(/^[A-Za-z]+-(\d+)$/) ?? id.match(/^(\d+)$/)
  return m ? all.find((r) => r.num == +m![1]) : all.find((r) => r.eid == id)
}

// The board sort: status column order, then priority, then num.
export let byBoard = (a: Row, b: Row) =>
  (statuses.indexOf(String(a.comps.task?.status)) -
    statuses.indexOf(String(b.comps.task?.status))) ||
  (Number(a.comps.task?.priority ?? 0) - Number(b.comps.task?.priority ?? 0)) ||
  (a.num - b.num)

export let idOf = (r: Row) =>
  `${
    ({ task: 'T', board: 'B', session: 'S' } as Record<string, string>)[
      r.kind
    ] ?? r.kind[0].toUpperCase()
  }-${r.num}`

// Find-or-mint the session entity for an external session id, plus the
// claim pointing at it — one batch, atomic on the server.
export let claimChanges = (
  all: Row[],
  target: string,
  session: string,
): Change[] => {
  let s = all.find((r) => r.comps.session && r.comps.session.id == session)
  let seid = s?.eid ?? crypto.randomUUID()
  return [
    ...(s ? [] : [{ eid: seid, name: 'session', comp: { id: session } }]),
    { eid: target, name: 'claim', comp: { session_eid: seid } },
  ]
}

// The claimant's session id, resolved through the claim's session entity.
export let claimant = (all: Row[], r: Row) => {
  let seid = r.comps.claim?.session_eid
  if (!seid) return undefined
  let s = all.find((x) => x.eid == seid)
  return String(s?.comps.session?.id ?? seid)
}
