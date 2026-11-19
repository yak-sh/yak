// The model a yaks.app Operator answers with, as data. A persona names it by
// `using{provider, model}` (@yaks/session), pointing at the model's own row,
// which carries its `price` (@yaks/model), as a project names what its work
// runs on (@yaks/harness `usingFor`). The platform's base persona, kept in the
// directory, names the model every Operator runs on; a space's own persona may
// name another. One write changes either, and the next turn reads it.
//
// A model row's eid is derived from its name, so the box's `O-` row and the
// directory's are the same entity: `choosing` copies the box's whole, price
// and all, and every step of that model is priced and bounded by it
// (`listingOf`).
import type { Bundle, Comp, Eid, Storage } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import { type Listed, MODEL, type Price, PROVIDER } from '@yaks/model'

/** The persona every Operator is worn on, kept in the directory. */
export let BASE: Eid = derivedEid('operator-persona|base')

/** What reads rows by eid: a graph, or the directory as the Operator reads
 * it. */
export type Rows = Pick<Storage, 'get'>

/** A model, by its provider's name and its own. */
export type Choice = { provider: string; model: string }

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined | null

// What a model row says of the model itself, wherever it is kept: not what one
// graph learned of serving it (`offered`, `enforced`).
let OWN = [
  'name',
  'vendor',
  'grade',
  'label',
  'modalities',
  'efforts',
  'effort',
  'context',
  'output',
]

/**
 * The model `persona` names in `rows`: the names of the provider and model
 * rows its `using` points at, or none where it names none.
 *
 * ```ts
 * import { BASE, choosing, namedBy } from '@yaks/platform/operator-model'
 * import { equal } from '@yaks/testing'
 *
 * let rows = choosing(
 *   { entity: { eid: 'O-1' }, model: { name: 'm' }, price: { input: 1 } },
 *   'p',
 * )
 * let get = (eids: string[]) =>
 *   rows.filter((b) => eids.includes(b.entity.eid))
 * equal(await namedBy({ get }, BASE), { provider: 'p', model: 'm' })
 * equal(await namedBy({ get }, 'nobody'), undefined)
 * ```
 */
export let namedBy = async (
  rows: Rows,
  persona: Eid,
): Promise<Choice | undefined> => {
  let [held] = await rows.get([persona])
  let using = comp(held, 'using')
  if (!using?.provider || !using.model) return undefined
  let found = await rows.get([String(using.provider), String(using.model)])
  let at = (eid: unknown) => found.find((b) => b?.entity.eid == eid)
  let provider = comp(at(using.provider), PROVIDER)?.name
  let model = comp(at(using.model), MODEL)?.name
  return provider && model
    ? { provider: String(provider), model: String(model) }
    : undefined
}

/** What a model's own row in `rows` says of it, by its name, as a provider
 * lists a model (`Listed`): its label, price, window and longest reply. */
export let listingOf = async (
  rows: Rows,
  name: string,
): Promise<Listed | undefined> => {
  let [row] = await rows.get([identityEid(MODEL, [name])])
  let model = comp(row, MODEL)
  if (!model) return undefined
  let price = comp(row, 'price') as Price | undefined
  let { label, context, output } = model as {
    label?: string
    context?: number
    output?: number
  }
  return {
    name,
    ...label ? { label } : {},
    ...context ? { context } : {},
    ...output ? { output } : {},
    ...price ? { price } : {},
  }
}

/** What makes the model `row` holds (`model{}` with its `price{}`) the one
 * the base persona names, served by `provider`: the provider's row, the
 * model's own row whole, and the persona's `using`. */
export let choosing = (row: Bundle, provider: string): Bundle[] => {
  let model = comp(row, MODEL) ?? {}
  let eid = identityEid(MODEL, [String(model.name)])
  let from = identityEid(PROVIDER, [provider])
  let price = comp(row, 'price')
  return [
    { entity: { eid: from }, [PROVIDER]: { name: provider } },
    {
      entity: { eid },
      [MODEL]: Object.fromEntries(
        Object.entries(model).filter(([p]) => OWN.includes(p)),
      ),
      ...price ? { price } : {},
    },
    { entity: { eid: BASE }, using: { provider: from, model: eid } },
  ]
}
