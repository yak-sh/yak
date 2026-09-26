// Which provider serves a model, read off the graph's `serves` edges. The
// implementations are the host's, keyed by `provider.name`: the runner is lent
// them (./run.ts `Runner`), and these say which of them answers a `using`.
//
// A transcript whose `using` names a provider this host has no implementation
// for is not refused here — it is somebody else's to answer: a command-line
// agent @yaks/spawn launches, or another host lent that provider.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { type Model, ModelError } from '@yaks/model'
import type { Served } from './react.ts'

/** One provider's offering of a model: who serves it, under what name, and
 * the implementation this host has for that provider (if any). */
export type Offer = {
  provider: Eid
  model: Eid
  name: string
  serve?: Model
}

/** Every `serves` edge that points at a model, each with the implementation
 * this host has for its provider. */
export let offers = async (
  g: Graph,
  model: Eid,
  implementations: Readonly<Record<string, Model>>,
): Promise<Offer[]> => {
  let edges = await g.read(`.serves .edge.to=${model}`)
  let froms = edges.map((b) => String((b.edge as Comp).from))
  let rows = froms.length ? await g.get(froms) : []
  let named = new Map(
    rows.filter(Boolean).map((b) => [
      b.entity.eid,
      (b.provider as Comp | undefined)?.name,
    ]),
  )
  return edges.map((b, i) => {
    let provider = named.get(froms[i])
    return {
      provider: froms[i],
      model,
      name: String((b.serves as Comp).name ?? ''),
      serve: typeof provider == 'string' &&
          Object.hasOwn(implementations, provider)
        ? implementations[provider]
        : undefined,
    }
  })
}

/** The offer a `using` resolves to: the named provider's, which must serve the
 * model, or else the one provider this host can reach that serves it. */
export let offerFor = (
  all: Offer[],
  provider?: unknown,
): Offer | string => {
  if (provider != null) {
    let named = all.find((o) => o.provider == provider)
    if (!named) return 'The selected provider does not serve this model'
    return named.serve
      ? named
      : 'No implementation configured for the selected provider'
  }
  let reachable = all.filter((o) => o.serve)
  if (reachable.length == 1) return reachable[0]
  return reachable.length
    ? 'Several providers serve this model; name one'
    : 'No implementation configured for a provider of this model'
}

/** The resolver a runner asks with (./react.ts `Deps.resolveModel`). One
 * `override` for every provider (a test's, an embedder's) still asks by the
 * provider's name for the model, and still refuses a provider that does not
 * serve it; a model nobody serves is asked by its own name. */
export let providerResolver = (
  g: Graph,
  implementations: Readonly<Record<string, Model>>,
  override?: Model,
): (using: Comp | undefined, model: Bundle) => Promise<Served> =>
async (using, model) => {
  let all = await offers(g, model.entity.eid, implementations)
  let found = override && using?.provider == null
    ? {
      serve: override,
      name: all[0]?.name ?? String((model.model as Comp).name),
    }
    : offerFor(
      override ? all.map((o) => ({ ...o, serve: override })) : all,
      using?.provider,
    )
  if (typeof found == 'string') {
    let refuse: Model = () => Promise.reject(new ModelError('provider', found))
    return { model: refuse, name: String((model.model as Comp).name) }
  }
  return { model: found.serve!, name: found.name }
}

/** Whether this host answers a transcript asking with `using`: the provider
 * it names is one this host has an implementation for, or it names none and
 * the model is one a provider this host reaches serves. An `override` answers
 * every provider but a command line (`transport: process`), which is
 * @yaks/spawn's to launch, and a `using` naming nothing at all.
 *
 * ```ts
 * import { answers } from '@yaks/session'
 *
 * // if (await answers(graph, { openai })(using)) …
 * ```
 */
export let answers = (
  g: Graph,
  implementations: Readonly<Record<string, Model>>,
  override?: Model,
) =>
async (using: Comp | undefined): Promise<boolean> => {
  let provider = using?.provider
  if (provider != null) {
    let [row] = await g.get([String(provider)])
    let named = row?.provider as Comp | undefined
    if (!named) return false
    if (override) return named.transport != 'process'
    return typeof named.name == 'string' &&
      Object.hasOwn(implementations, named.name)
  }
  if (override) return true
  if (using?.model == null) return false
  let all = await offers(g, String(using.model), implementations)
  return all.some((o) => o.serve)
}
