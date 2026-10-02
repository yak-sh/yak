// The credential's own model listing; OpenAI gives names, Codex also windows.
import { type Listed, ModelError } from '@yaks/model'
import { CODEX, type Credential } from './credential.ts'

export type ListingOptions = {
  retries?: number
  pause?: (ms: number) => Promise<void>
}

let sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

let request = async (
  url: URL,
  init: RequestInit,
  fetcher: typeof fetch,
  opts: ListingOptions,
): Promise<Response> => {
  let retries = opts.retries ?? 2
  for (let failures = 0;; failures++) {
    try {
      return await fetcher(url, init)
    } catch (error) {
      if (failures >= retries) {
        throw new ModelError(
          'transport',
          `Model listing transport failed: ${
            String((error as Error)?.message ?? error)
          }`,
          { after: 0 },
        )
      }
      await (opts.pause ?? sleep)(Math.min(1000 * 4 ** failures, 60_000))
    }
  }
}

export let listing = async (
  cred: Credential,
  fetcher: typeof fetch = fetch,
  refresh?: (stale: Credential) => Credential | Promise<Credential>,
  headers: Record<string, string> = {},
  opts: ListingOptions = {},
): Promise<Listed[]> => {
  let url = new URL(cred.base.replace(/\/$/, '') + '/models')
  if (cred.base == CODEX) url.searchParams.set('client_version', '0.157.1')
  let res = await request(
    url,
    {
      headers: {
        ...headers,
        ...cred.token ? { authorization: `Bearer ${cred.token}` } : {},
        ...cred.account ? { 'chatgpt-account-id': cred.account } : {},
      },
    },
    fetcher,
    opts,
  )
  if (res.status == 401 && cred.base == CODEX && refresh) {
    await res.body?.cancel()
    return listing(await refresh(cred), fetcher, undefined, headers, opts)
  }
  if (!res.ok) {
    throw new ModelError(
      `http_${res.status}`,
      `Model listing says ${res.status}`,
    )
  }
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
