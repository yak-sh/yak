/** Which provider serves a model, read off the graph's `serves` edges; the
 * implementations are the host's, keyed by `provider.name`. */
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { type Model, ModelError } from '@yaks/model'
import type { Served } from '@yaks/session'

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
export const offers = async (
  g: Graph,
  model: Eid,
  implementations: Readonly<Record<string, Model>>,
): Promise<Offer[]> => {
  const edges = await g.read(`.serves .edge.to=${model}`)
  const froms = edges.map((b) => String((b.edge as Comp).from))
  const rows = froms.length ? await g.storage.tx((tx) => tx.get(froms)) : []
  const named = new Map(
    rows.filter(Boolean).map((
      b,
    ) => [b.entity.eid, (b.provider as Comp | undefined)?.name]),
  )
  return edges.map((b, i) => {
    const provider = named.get(froms[i])
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
export const offerFor = (
  all: Offer[],
  provider?: unknown,
): Offer | string => {
  if (provider != null) {
    const named = all.find((o) => o.provider == provider)
    if (!named) return 'The selected provider does not serve this model'
    return named.serve
      ? named
      : 'No implementation configured for the selected provider'
  }
  const reachable = all.filter((o) => o.serve)
  if (reachable.length == 1) return reachable[0]
  return reachable.length
    ? 'Several providers serve this model; name one'
    : 'No implementation configured for a provider of this model'
}

export const providerResolver = (
  g: Graph,
  implementations: Readonly<Record<string, Model>>,
  override?: Model,
): (using: Comp | undefined, model: Bundle) => Promise<Served> =>
async (using, model) => {
  const all = await offers(g, model.entity.eid, implementations)
  // One implementation for every provider (a test's, an embedder's) still
  // asks by the provider's spelling, and still refuses a provider that does
  // not serve the model; a model nobody serves is asked by its own name.
  const found = override && using?.provider == null
    ? {
      serve: override,
      name: all[0]?.name ?? String((model.model as Comp).name),
    }
    : offerFor(
      override ? all.map((o) => ({ ...o, serve: override })) : all,
      using?.provider,
    )
  if (typeof found == 'string') {
    const refuse: Model = () =>
      Promise.reject(new ModelError('provider', found))
    return { model: refuse, name: String((model.model as Comp).name) }
  }
  return { model: found.serve!, name: found.name }
}
