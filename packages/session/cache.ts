// Prompt-cache observations from request entries and their existing provenance.
// Missing counts stay unknown; shares weight input tokens, never requests.
// The reader needs only the graph's read/get doors, on a box or an app store.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { Refused } from '@yaks/graph'
import { and, eq, ge, lt, or, present, want } from '@yaks/query'

export type CacheOpts = {
  from?: string
  until?: string
  session?: string
  requests?: boolean
}

export type CacheRequest = {
  request: string
  at: string | null
  session: string
  provider: string
  model: string
  path: string
  input_tokens: number | null
  cached_tokens: number | null
  cached_share: number | null
}

export type CacheTotals = {
  requests: number
  input_tokens: number
  cached_tokens: number
  reported_input_tokens: number
  reported_cached_tokens: number
  unknown_cache_input_tokens: number
  unknown_input_requests: number
  unknown_cache_requests: number
  zero_cache_requests: number
  cached_share: number | null
}

export type CacheReport = {
  from: string | null
  until: string | null
  total: CacheTotals
  imported_observations: number
  groups: Record<string, (CacheTotals & { key: string })[]>
  requests?: CacheRequest[]
}

let comp = (b: Bundle | undefined, name: string): Comp =>
  b?.[name] as Comp ?? {}
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let count = (v: unknown): number | null =>
  typeof v == 'number' && Number.isFinite(v) && v >= 0 ? v : null
let ids = (values: string[]) => [...new Set(values.filter(Boolean))]
let unknown = (v: unknown) => str(v) || 'unknown'

/** UTC instants are explicit; the upper bound is exclusive for adjacent runs. */
export let cacheTime = (value?: string): string | undefined => {
  if (value == null) return undefined
  if (
    !/(Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))
  ) {
    throw new Refused('cache dates need an ISO instant with timezone')
  }
  return new Date(value).toISOString()
}

let totals = (rows: CacheRequest[]): CacheTotals => {
  let paired = rows.filter((r) =>
    r.input_tokens != null && r.cached_tokens != null
  )
  let input = paired.reduce((n, r) => n + (r.input_tokens ?? 0), 0)
  let cached = paired.reduce((n, r) => n + (r.cached_tokens ?? 0), 0)
  return {
    requests: rows.length,
    input_tokens: rows.reduce((n, r) => n + (r.input_tokens ?? 0), 0),
    cached_tokens: rows.reduce((n, r) => n + (r.cached_tokens ?? 0), 0),
    reported_input_tokens: input,
    reported_cached_tokens: cached,
    unknown_cache_input_tokens: rows.filter((r) => r.cached_tokens == null)
      .reduce((n, r) => n + (r.input_tokens ?? 0), 0),
    unknown_input_requests: rows.filter((r) => r.input_tokens == null).length,
    unknown_cache_requests: rows.filter((r) => r.cached_tokens == null).length,
    zero_cache_requests: rows.filter((r) => r.cached_tokens == 0).length,
    cached_share: input > 0 ? cached / input : null,
  }
}

/** Source call -> build identifies builders without storing a second label. */
let pathOf = (s: Bundle | undefined, byId: Map<string, Bundle>): string => {
  let sourceId = str(comp(s, 'session').source)
  let source = byId.get(sourceId)
  let origin = byId.get(str(comp(source, 'call').source))
  let tool = byId.get(str(comp(source, 'call').to))
  if (origin?.build) return 'builder'
  if (
    comp(tool, 'tool').name == 'session_compact' ||
    comp(source, 'call').name == 'session_compact'
  ) return 'compaction'
  if (sourceId) return 'other'
  return s?.imported || comp(s, 'session').log ? 'imported' : 'native'
}

/** Pure reduction of request bundles plus their session/call/model metadata. */
export let cacheOf = (
  rows: Bundle[],
  metadata: Bundle[] = [],
  opts: CacheOpts = {},
): CacheReport => {
  let from = cacheTime(opts.from)
  let until = cacheTime(opts.until)
  if (from && until && from >= until) {
    throw new Refused('cache from must precede until')
  }
  let byId = new Map(metadata.map((b) => [b.entity.eid, b]))
  let seen = new Set<string>()
  let requests: CacheRequest[] = []
  for (let b of rows) {
    let session = str(comp(b, 'entry').session)
    if (!session || !b.ask && !b.usage || seen.has(b.entity.eid)) continue
    seen.add(b.entity.eid)
    let at = str(comp(b, 'created').at)
    let instant = Number.isFinite(Date.parse(at))
      ? new Date(at).toISOString()
      : null
    if (opts.session && session != opts.session) continue
    if ((from || until) && !instant) continue
    if (from && instant! < from || until && instant! >= until) continue
    let using = comp(b, 'using')
    let provider = str(using.provider)
    let model = str(comp(b, 'ask').to) || str(using.model)
    let input = count(comp(b, 'usage').input_tokens)
    let cached = count(comp(b, 'usage').cached_tokens)
    requests.push({
      request: b.entity.eid,
      at: instant,
      session,
      provider: unknown(comp(byId.get(provider), 'provider').name || provider),
      model: unknown(comp(byId.get(model), 'model').name || model),
      path: b.ask ? pathOf(byId.get(session), byId) : 'imported',
      input_tokens: input,
      cached_tokens: cached,
      cached_share: input != null && input > 0 && cached != null
        ? cached / input
        : null,
    })
  }
  requests.sort((a, b) =>
    (a.at ?? '').localeCompare(b.at ?? '') ||
    a.request.localeCompare(b.request)
  )
  let asked = new Set(rows.filter((b) => b.ask).map((b) => b.entity.eid))
  let measured = requests.filter((r) => asked.has(r.request))
  let group = (key: 'session' | 'provider' | 'model' | 'path') => {
    let buckets = new Map<string, CacheRequest[]>()
    for (let r of key == 'path' ? requests : measured) {
      let bucket = buckets.get(r[key]) ?? []
      bucket.push(r)
      buckets.set(r[key], bucket)
    }
    return [...buckets].sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => ({ key, ...totals(rows) }))
  }
  return {
    from: from ?? null,
    until: until ?? null,
    total: totals(measured),
    imported_observations: requests.length - measured.length,
    groups: {
      session: group('session'),
      provider: group('provider'),
      model: group('model'),
      path: group('path'),
    },
    ...(opts.requests ? { requests } : {}),
  }
}

/** Select only observations in range, then batch-fetch provenance, not logs. */
export let cacheRead = async (
  g: Pick<Graph, 'read' | 'get'>,
  opts: CacheOpts = {},
): Promise<CacheReport> => {
  let from = cacheTime(opts.from)
  let until = cacheTime(opts.until)
  if (from && until && from >= until) {
    throw new Refused('cache from must precede until')
  }
  let rows = await g.read(and(
    present('entry'),
    or(present('ask'), present('usage')),
    ...from ? [ge('created.at', from)] : [],
    ...until ? [lt('created.at', until)] : [],
    ...opts.session ? [eq('entry.session', opts.session)] : [],
    ...['created', 'using', 'usage', 'ask'].map(want),
  ))
  let get = async (keys: string[], comps: string[]) =>
    keys.length ? await g.get(ids(keys), comps) : []
  let sessions = await get(rows.map((b) => str(comp(b, 'entry').session)), [
    'session',
    'imported',
  ])
  let calls = await get(sessions.map((s) => str(comp(s, 'session').source)), [
    'call',
  ])
  let origins = await get(
    calls.flatMap((c) => [
      str(comp(c, 'call').source),
      str(comp(c, 'call').to),
    ]),
    ['build', 'tool'],
  )
  let models = await get(
    rows.flatMap((b) => [
      str(comp(b, 'using').provider),
      str(comp(b, 'using').model),
      str(comp(b, 'ask').to),
    ]),
    ['provider', 'model'],
  )
  return cacheOf(rows, [...sessions, ...calls, ...origins, ...models], opts)
}
