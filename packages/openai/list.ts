// The credential's own model listing; OpenAI gives names, Codex also windows.
import { type Listed, ModelError } from '@yaks/model'
import { CODEX, type Credential } from './credential.ts'
import { ResponseError } from './transport.ts'

export type ListingOptions = {
  retries?: number
  pause?: (ms: number) => Promise<void>
}

let sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// Unlike the exponential delay's cap, Retry-After is a lower bound, even
// when the provider asks for more than a minute. Both header forms are valid.
let retryAfter = (headers: Headers): number => {
  let value = headers.get('retry-after')?.trim()
  if (!value) return 0
  let ms = /^\d+(\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now()
  return Number.isFinite(ms) ? Math.max(0, ms) : 0
}

let request = async (
  url: URL,
  init: RequestInit,
  fetcher: typeof fetch,
  opts: ListingOptions,
): Promise<Response> => {
  let retries = opts.retries ?? 2
  for (let failures = 0;; failures++) {
    let response: Response
    try {
      response = await fetcher(url, init)
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
      continue
    }
    if (response.ok || response.status == 401) return response

    // Consume error responses before retrying, releasing the connection. Use
    // the Responses transport's capacity/quota classification, but never put
    // the provider's possibly credential-bearing error body in the exception.
    let body = await response.text().catch(() => '')
    let code: string | undefined
    try {
      let error = JSON.parse(body)?.error
      if (typeof error?.code == 'string') code = error.code
      else if (typeof error?.type == 'string') code = error.type
    } catch { /* A gateway may return HTML rather than a provider error. */ }
    let fault = new ResponseError(
      `http_${response.status}`,
      `Model listing says ${response.status}`,
    )
    fault.status = response.status
    fault.code = code
    let transient = !!fault.retry || response.status == 408 ||
      response.status == 409
    let after = retryAfter(response.headers)
    if (!transient || failures >= retries) {
      throw new ModelError(
        fault.kind,
        fault.message,
        transient ? { after } : undefined,
      )
    }
    await (opts.pause ?? sleep)(
      Math.max(Math.min(1000 * 4 ** failures, 60_000), after),
    )
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
    await res.body?.cancel()
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
