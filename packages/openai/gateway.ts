// Responses through a Cloudflare AI Gateway. Credentials and routing are data.
import { type Model, ModelError } from '@yaks/model'
import { responses } from './responses.ts'

export type Gateway = {
  base?: string
  account?: string
  gateway?: string
  ai?: { gateway(id: string): { getUrl(provider?: string): Promise<string> } }
  key?: string
  token?: string
  fetch?: typeof fetch
}

export let endpoint = async (o: Gateway): Promise<string> => {
  let base = o.base ??
    (o.gateway && o.ai
      ? await o.ai.gateway(o.gateway).getUrl('openai')
      : o.gateway && o.account
      ? `https://gateway.ai.cloudflare.com/v1/${o.account}/${o.gateway}/openai`
      : undefined)
  if (!base) throw new ModelError('unbound', 'No OpenAI gateway is configured')
  return base.replace(/\/+$/, '')
}

export let gateway = (o: Gateway): Model => {
  let model = responses({
    credential: async () => ({ token: o.key ?? '', base: await endpoint(o) }),
    authentication: 'optional',
    headers: o.token ? { 'cf-aig-authorization': `Bearer ${o.token}` } : {},
    fetch: o.fetch,
    store: false,
    web: false,
  })
  return model
}
