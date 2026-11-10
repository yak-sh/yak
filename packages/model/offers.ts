// Which provider serves a model, read off a graph's `serves` edges. The
// implementations are the host's, keyed by `provider.name`, and these say
// which of them answers a model.

import type { Comp, Eid, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { type Model, ModelError } from './mod.ts'
import { MODEL } from './vocab.ts'

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
  g: Pick<Graph, 'read' | 'get'>,
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

/** A host's providers as one model, asked for a model by its own name
 * (`model.name`, the same row in every graph): the one of `implementations`
 * whose provider `g` says serves it answers, under the name that provider
 * calls it. A name none of them serves, or several do, is refused with a
 * `ModelError` coded `provider`. */
export let serving = (
  g: Pick<Graph, 'read' | 'get'>,
  implementations: Readonly<Record<string, Model>>,
): Model =>
async (req) => {
  let model = identityEid(MODEL, [req.model])
  let found = offerFor(await offers(g, model, implementations))
  if (typeof found == 'string') throw new ModelError('provider', found)
  return found.serve!({ ...req, model: found.name })
}
