/** Model choices are graph records: a choice is one provider's offering of a
 * model, its `serves` edge. */
import { type Bundle, type Comp, type Graph } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import type { Model } from '@yaks/model'
import { offerFor, offers } from '@yaks/session'

export type ModelSelection = { choices: Bundle[]; current?: string }

/** The `using` a choice records. `id` is an offering (a `serves` edge), which
 * names the provider as well, or a model, whose provider is resolved from the
 * offerings this host can reach. A configured provider is never refused here,
 * and an unconfigured one fails before it is recorded. */
export const modelUsing = async (
  g: Graph,
  id: string,
  implementations: Readonly<Record<string, Model>>,
): Promise<Comp> => {
  const [row] = await g.get([id])
  const edge = row?.serves ? row.edge as Comp : undefined
  const model = edge ? String(edge.to) : row?.model ? id : undefined
  if (!model) throw new Error('Unknown model')
  const found = offerFor(
    await offers(g, model, implementations),
    edge?.from,
  )
  if (typeof found == 'string') throw new Error(found)
  return { model, provider: found.provider }
}

/** Read configuration metadata only, following a fork's bounded prefix. */
export const selectedUsing = async (
  g: Graph,
  session: string,
  before?: number,
  seen = new Set<string>(),
): Promise<Comp | undefined> => {
  if (seen.has(session)) throw new Error('Cyclic session ancestry')
  seen.add(session)
  const rows = await g.read(
    '.entry.session=' + session + '&.using&!ask' +
      (before == null ? '' : '&.entry.seq<=' + before) +
      '&.order=-entry.seq&.limit=1&.fields=using.model,using.provider,using.effort,using.instructions',
  )
  if (rows.length) return rows[0].using as Comp
  const [owner] = await g.get([session])
  const from = (owner?.fork as Comp | undefined)?.from
  if (!from) return undefined
  const [anchor] = await g.get([String(from)])
  const entry = anchor?.entry as Comp | undefined
  return entry
    ? selectedUsing(g, String(entry.session), Number(entry.seq), seen)
    : undefined
}

/** Every offering, each as its edge's id wearing the model and the provider's
 * name, and the one in force: the session's, else `fallback`. */
export const modelSelection = async (
  g: Graph,
  session: string | undefined,
  fallback: Comp,
): Promise<ModelSelection> => {
  const named = new Map(
    [...await g.read('.provider'), ...await g.read('.model')].map((b) => [
      b.entity.eid,
      b,
    ]),
  )
  const choices = (await g.read('.serves&?edge')).flatMap((b): Bundle[] => {
    const { from, to } = b.edge as Comp
    const model = named.get(String(to))?.model
    const provider = named.get(String(from))?.provider
    return model && provider
      ? [{ entity: b.entity, edge: b.edge, serves: b.serves, model, provider }]
      : []
  }).sort((a, b) =>
    String((a.model as Comp).name).localeCompare(String((b.model as Comp).name))
  )
  const using = (session ? await selectedUsing(g, session) : undefined) ??
    fallback
  const current = using.provider
    ? edgeEid(String(using.provider), 'serves', String(using.model))
    : choices.find((c) => (c.edge as Comp).to == using.model)?.entity.eid
  return { choices, current }
}
