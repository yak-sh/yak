// The model every yaks.app Operator runs on, set from the box
// (@yaks/platform/operator-model): this graph's `O-` row of the model, its
// price beside it, is written whole to the directory, whose base persona then
// names it. The box's row is the one source: a model it holds no price for
// takes its list price there first.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { type Listed, listPrice } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import {
  BASE,
  type Choice,
  choosing,
  listingOf,
  namedBy,
  type Rows,
} from '@yaks/platform/operator-model'

/** What the directory says every Operator runs on: the model, its provider,
 * and what its row says of it. */
export let operatorModel = async (
  directory: Rows,
): Promise<(Choice & Partial<Listed>) | undefined> => {
  let chosen = await namedBy(directory, BASE)
  return chosen && { ...await listingOf(directory, chosen.model), ...chosen }
}

/** The writes that make the model `named` (its `O-` id or its name) the one
 * every Operator runs on, served by `provider` (the model's vendor where
 * none is named): the price its row on the box takes first where it has
 * none, and the directory's rows. */
export let operatorRows = async (
  graph: Graph,
  named: string,
  provider?: string,
): Promise<{ box: Bundle[]; directory: Bundle[] }> => {
  let eid = (await graph.address([named])).get(named) ??
    identityEid('model', [named])
  let [row] = await graph.get([eid])
  let model = row?.model as Comp | undefined
  if (!model?.name) {
    throw new CallError('model', `${named} is no model this graph holds`)
  }
  let price = row.price ?? listPrice(String(model.name))
  if (!price) {
    throw new CallError(
      'model',
      `${named} has no price: give its row price{input, output} first`,
    )
  }
  let from = provider ?? model.vendor
  if (!from) {
    throw new CallError(
      'provider',
      `${named} names no vendor: say which provider serves it`,
    )
  }
  return {
    box: row.price ? [] : [{ entity: { eid }, price }],
    directory: choosing({ ...row, price }, String(from)),
  }
}

let dollars = (n: unknown) => `$${n}`

/** The model every Operator runs on, as a line. */
export let modelLine = (now?: Choice & Partial<Listed>): string =>
  now
    ? [
      `${now.model} on ${now.provider}`,
      now.price
        ? `${dollars(now.price.input)} in, ${
          dollars(now.price.output)
        } out per million tokens`
        : 'no price',
      now.context ? `a window of ${now.context.toLocaleString('en-US')}` : '',
    ].filter(Boolean).join(', ')
    : 'The directory names no model: every Operator runs on the first of config.ts agents.operator its Worker holds the keys of.'
