// The credential's own model listing; OpenAI gives names, Codex also windows.
import type { Listed } from '@yaks/model'
import { CODEX, type Credential } from './credential.ts'

export let listing = async (
  cred: Credential,
  fetcher: typeof fetch = fetch,
  refresh?: (stale: Credential) => Credential | Promise<Credential>,
  headers: Record<string, string> = {},
): Promise<Listed[]> => {
  let url = new URL(cred.base.replace(/\/$/, '') + '/models')
  if (cred.base == CODEX) url.searchParams.set('client_version', '0.157.1')
  let res = await fetcher(url, {
    headers: {
      ...headers,
      ...cred.token ? { authorization: `Bearer ${cred.token}` } : {},
      ...cred.account ? { 'chatgpt-account-id': cred.account } : {},
    },
  })
  if (res.status == 401 && cred.base == CODEX && refresh) {
    await res.body?.cancel()
    return listing(await refresh(cred), fetcher)
  }
  if (!res.ok) throw new Error(`Model listing says ${res.status}`)
  let body: {
    data?: { id: string; context_length?: number }[]
    models?: { slug: string; context_window?: number }[]
  } = await res.json()
  return body.models?.map((m) => ({
    name: m.slug,
    ...m.context_window ? { context: m.context_window } : {},
  })) ??
    (body.data ?? []).map((m) => ({
      name: m.id,
      ...m.context_length ? { context: m.context_length } : {},
    }))
}
