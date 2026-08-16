// The provider-neutral spawn hub. Every door presents ONE model catalog and
// picks the transport that can actually run a chosen model — graph-native when
// its account is ready, the permanent CLI fallback otherwise. The picker never
// meets a provider twice: a fallback transport carries the model but no menu
// label of its own, so it appends to a model's transports instead of minting a
// duplicate entry. This module is DOM- and signal-free so the server, CLI, and
// browser all share the same rules.

export type Provider = {
  name: string
  models: string[]
  labels?: Record<string, string>
  efforts?: string[]
  // A CLI fallback transport: valid and directly requestable, but never a menu
  // entry of its own and always ranked behind the graph-native provider.
  fallback?: boolean
  // Stamped by the server from account readiness; ready === false means the
  // provider cannot run right now, so the default blocker routes around it.
  ready?: boolean
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

// The default blocker, read from the table itself: a provider the server
// stamped not-ready cannot run, so a stamped /providers routes for free.
let tableBlocked = (ps: Provider[]) => (name: string) =>
  ps.find((p) => p.name == name)?.ready === false

// The unified menu: each labeled model once, Sol first.
export let catalog = (ps: Provider[]): Pick[] => {
  let picks = new Map<string, Pick>()
  for (let p of ranked(ps)) {
    for (let [model, label] of Object.entries(p.labels ?? {})) {
      if (picks.has(model)) continue
      picks.set(model, {
        model,
        label,
        efforts: p.efforts ?? [],
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
// request, honored as-is; otherwise the default model routes to its best usable
// transport by readiness.
export let spawnDefault = (
  ps: Provider[],
  want: Spawn = {},
  blocked: (name: string) => boolean = tableBlocked(ps),
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
  return {
    provider: ts.find((name) => !blocked(name)) ?? ts[ts.length - 1],
    model,
  }
}
