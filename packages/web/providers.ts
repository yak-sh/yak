// The provider-neutral spawn hub. Every door presents ONE model catalog and
// picks the transport that can actually run a chosen model — graph-native when
// its account is ready, the permanent CLI fallback otherwise. The picker never
// meets a provider twice: a fallback transport carries the model but no menu
// label of its own, so it appends to a model's transports instead of minting a
// duplicate entry. This module is DOM- and signal-free so the server, CLI, and
// browser all share the same rules.
//
// The table is the graph's: a `provider` entity, a `model` entity, and the
// `serves` edge from one to the other (@yaks/model). tableOf() reads those
// rows into the shape below, and usingOf() turns a pick back into the entity
// references a session's `using` holds.

export type Provider = {
  name: string
  // The provider entity, and each model's entity by name: what `using` holds.
  eid?: string
  eids?: Record<string, string>
  models: string[]
  labels?: Record<string, string>
  // model → the efforts it accepts, keyed the way `labels` is.
  efforts?: Record<string, string[]>
  // A CLI fallback transport: valid and directly requestable, but never a menu
  // entry of its own and always ranked behind the graph-native provider.
  fallback?: boolean
  // model → the effort to ask for when no tier named one (the model's
  // `effort`), keyed the way `labels` is.
  defaults?: Record<string, string>
}

type Row = { entity: { eid: string } } & Record<string, unknown>
type Comp = Record<string, unknown>
let text = (v: unknown) => (typeof v == 'string' && v ? v : undefined)

/** The providers the graph offers, from its `provider` and `model` rows and
 * the `serves` edges between them. Only a provider marked `offered` is listed
 * (never the in-repo `fake` rig), and a model gets a menu label only once it
 * is offered too. */
export let tableOf = (rows: Row[]): Provider[] => {
  let byEid = new Map(rows.map((r) => [r.entity.eid, r]))
  let out = new Map<string, Provider>()
  for (let r of rows) {
    let edge = r.edge as Comp | undefined
    if (!r.serves || !edge) continue
    let p = byEid.get(String(edge.from))?.provider as Comp | undefined
    let target = byEid.get(String(edge.to))
    let m = target?.model as Comp | undefined
    let name = text(p?.name)
    let model = text(m?.name)
    if (!p || !m || !name || !model || p.offered !== true) continue
    let row = out.get(name) ?? {
      name,
      eid: String(edge.from),
      eids: {},
      models: [],
      labels: {},
      efforts: {},
      defaults: {},
      ...(p.fallback ? { fallback: true } : {}),
    }
    out.set(name, row)
    row.models.push(model)
    row.eids![model] = target!.entity.eid
    let label = text(m.label)
    if (label && m.offered === true) row.labels![model] = label
    let efforts = text(m.efforts)?.split(/\s+/) ?? []
    if (efforts.length) row.efforts![model] = efforts
    let effort = text(m.effort)
    if (effort) row.defaults![model] = effort
  }
  return [...out.values()]
}

/** A pick as a session's `using`: the provider and model entities it names.
 * Refused when the table has no such provider, or that provider does not
 * serve the model, so nothing is written that the host would refuse. */
export let usingOf = (
  ps: Provider[],
  pick: { provider: string; model?: string; effort?: string },
): { provider: string; model?: string; effort?: string } => {
  let p = ps.find((x) => x.name == pick.provider)
  if (!p?.eid) throw new Error(`no provider: ${pick.provider}`)
  let model = pick.model ? p.eids?.[pick.model] : undefined
  if (pick.model && !model) {
    throw new Error(`${pick.provider} does not serve ${pick.model}`)
  }
  return {
    provider: p.eid,
    ...(model ? { model } : {}),
    ...(pick.effort ? { effort: pick.effort } : {}),
  }
}
type Spawn = { provider?: string; model?: string }

// One compatible model, offered once. label/efforts come from the primary
// (non-fallback) transport that names it; transports lists every provider that
// can run it, graph-native first and the CLI fallback last.
export type Pick = {
  model: string
  label: string
  efforts: string[]
  transports: string[]
}

let first = 'gpt-5.6-sol'

// Sol leads the menu; everything else keeps its table order.
export let modelOrder = (a: string, b: string) =>
  Number(b == first) - Number(a == first)

// Graph-native transports before the CLI fallback.
let ranked = (ps: Provider[]) =>
  [...ps].sort((a, b) => Number(!!a.fallback) - Number(!!b.fallback))

// Every provider that can run a model, preferred first.
let transportsOf = (ps: Provider[], model: string) =>
  ranked(ps).filter((p) => p.models.includes(model)).map((p) => p.name)

// The unified menu: each labeled model once, Sol first.
export let catalog = (ps: Provider[]): Pick[] => {
  let picks = new Map<string, Pick>()
  for (let p of ranked(ps)) {
    for (let [model, label] of Object.entries(p.labels ?? {})) {
      if (picks.has(model)) continue
      picks.set(model, {
        model,
        label,
        efforts: p.efforts?.[model] ?? [],
        transports: transportsOf(ps, model),
      })
    }
  }
  return [...picks.values()].sort((a, b) => modelOrder(a.model, b.model))
}

export let offer = (picks: Pick[], want: Spawn = {}) =>
  want.model
    ? picks.find((p) =>
      p.model == want.model &&
      (!want.provider || p.transports.includes(want.provider))
    )
    : want.provider
    ? picks.find((p) => p.transports.includes(want.provider!))
    : picks[0]

// The transport to actually run a picked model: the first one the caller
// doesn't block, else the last-resort fallback. A graph-native provider is
// blocked when its account isn't ready; a CLI fallback never is.
export let transport = (
  pick: Pick,
  blocked: (name: string) => boolean,
): string =>
  pick.transports.find((name) => !blocked(name)) ??
    pick.transports[pick.transports.length - 1]

// The provider-neutral spawn default. Every door inherits a calling session
// first; without one they meet here, so a comment, command bar, CLI, and tool
// cannot silently choose different agents. An explicit provider is a direct
// request, honored as-is; otherwise the chosen model routes to its best usable
// transport by readiness.
export let spawnDefault = (
  ps: Provider[],
  want: Spawn = {},
  blocked: (name: string) => boolean = () => false,
): Spawn => {
  if (want.provider) {
    let p = ps.find((x) => x.name == want.provider)
    return {
      provider: want.provider,
      model: want.model ?? (p?.models.includes(first) ? first : p?.models[0]),
    }
  }
  let model = want.model ??
    (ps.some((p) => p.models.includes(first))
      ? first
      : ranked(ps)[0]?.models[0])
  if (!model) return { provider: undefined, model: undefined }
  let ts = transportsOf(ps, model)
  if (!ts.length) {
    throw new Error(
      `no provider serves model: ${model}; available providers: ${
        ps.map((p) => p.name).join(', ') || '(none)'
      }`,
    )
  }
  return {
    provider: ts.find((name) => !blocked(name)) ?? ts[ts.length - 1],
    model,
  }
}
