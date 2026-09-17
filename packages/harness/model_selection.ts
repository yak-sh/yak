/** Model choices are graph records; the provider always comes from the model. */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Model } from '@yaks/model'

export type ModelSelection = { choices: Bundle[]; current?: string }

export const modelUsing = async (
  g: Graph,
  id: string,
  implementations: Readonly<Record<string, Model>>,
): Promise<Comp> => {
  const [row] = await g.storage.tx((tx) => tx.get([id]))
  const model = row?.model as Comp | undefined
  if (!model || typeof model.provider != 'string') {
    throw new Error('Unknown model or missing provider')
  }
  const [provider] = await g.storage.tx((tx) =>
    tx.get([model.provider as string])
  )
  const name = (provider?.provider as Comp | undefined)?.name
  // The same record the resolver dispatches on, so a configured provider is
  // never refused here and an unconfigured one fails before it is recorded.
  if (typeof name != 'string' || !Object.hasOwn(implementations, name)) {
    throw new Error('No implementation configured for the selected provider')
  }
  return { model: id, provider: model.provider }
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
    '.entry.session=' + session + '&.using&.ask=' +
      (before == null ? '' : '&.entry.seq<=' + before) +
      '&.order=-entry.seq&.limit=1&.fields=using.model,using.provider,using.effort,using.instructions',
  )
  if (rows.length) return rows[0].using as Comp
  const [owner] = await g.storage.tx((tx) => tx.get([session]))
  const from = (owner?.fork as Comp | undefined)?.from
  if (!from) return undefined
  const [anchor] = await g.storage.tx((tx) => tx.get([String(from)]))
  const entry = anchor?.entry as Comp | undefined
  return entry
    ? selectedUsing(g, String(entry.session), Number(entry.seq), seen)
    : undefined
}

export const modelSelection = async (
  g: Graph,
  session: string | undefined,
  fallback: string,
): Promise<ModelSelection> => {
  const providers = new Map(
    (await g.read('.provider')).map((
      b,
    ) => [b.entity.eid, (b.provider as Comp).name]),
  )
  const choices = (await g.read('.model')).map((b): Bundle => ({
    ...b,
    provider: {
      name: providers.get(String((b.model as Comp).provider)) ?? 'unknown',
    },
  })).sort((a, b) =>
    String((a.model as Comp).name).localeCompare(String((b.model as Comp).name))
  )
  return {
    choices,
    current: session
      ? String((await selectedUsing(g, session))?.model ?? fallback)
      : fallback,
  }
}
