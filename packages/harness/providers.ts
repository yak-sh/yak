/** Provider implementation lookup; provider/model configuration lives in the graph. */
import { type Bundle, type Comp, derivedEid, type Graph } from '@yaks/graph'
import { type Model, ModelError } from '@yaks/model'

// Keep existing OpenAI identities readable for old databases. New providers use
// derived UUIDs, qualified by provider so equal model names cannot collide.
export const providerEid = (name: string): string =>
  name === 'openai' ? 'provider:openai' : derivedEid('model-provider|' + name)
export const modelEid = (provider: string, name: string): string =>
  provider === 'openai'
    ? 'model:' + name
    : derivedEid('provider-model|' + provider + '|' + name)

export const providerResolver = (
  g: Graph,
  implementations: Readonly<Record<string, Model>>,
  override?: Model,
): (using: Comp | undefined, model: Bundle) => Promise<Model> =>
async (using, model) => {
  const declared = (model.model as Comp).provider
  const requested = using?.provider ?? declared
  const reject = (message: string): Model => () =>
    Promise.reject(new ModelError('provider', message))
  if (declared && requested !== declared) {
    return reject('Selected model belongs to a different provider')
  }
  if (override) return override
  if (!requested) return reject('Selected model has no provider')
  const [row] = await g.storage.tx((tx) => tx.get([String(requested)]))
  const name = (row?.provider as Comp | undefined)?.name
  if (typeof name !== 'string' || !Object.hasOwn(implementations, name)) {
    return reject('No implementation configured for the selected provider')
  }
  return implementations[name]
}
