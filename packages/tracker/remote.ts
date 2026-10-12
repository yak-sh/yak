// The box shares one signed tracker transport for reads, intake and bug marks.
// Credentials are read at use time and never reach redirects or error text.
import { derivedEid } from '@yaks/graph/identity'
import type { Sink } from './report.ts'
import { sign } from './ticket.ts'

export type Remote = { url?: string; secret?: string }
export let request = async (
  remote: Remote,
  path: string,
  params: URLSearchParams,
  init: RequestInit = {},
  go: typeof fetch = fetch,
): Promise<Response> => {
  if (!remote.url || !remote.secret) {
    throw Error('Remote tracker is unavailable')
  }
  let url: URL
  try {
    url = new URL(remote.url)
  } catch {
    throw Error('Remote tracker address is invalid')
  }
  if (
    url.username || url.password ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.protocol == 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) throw Error('Remote tracker address is invalid')
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`
  url.search = params.toString()
  url.hash = ''
  let scope = params.get('scope') ?? 'platform'
  let ticket = await sign({
    scope: scope == 'platform' ? derivedEid('tracker|platform') : scope,
    person: 'box-tracker',
    admin: true,
    ...path == 'errors' ? { ingest: true } : {},
    ...['resolve', 'archive', 'deployed'].includes(path) ? { mark: true } : {},
    exp: Math.floor(Date.now() / 1000) + 60,
  }, remote.secret)
  let headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${ticket}`)
  try {
    return await go(url, {
      ...init,
      headers,
      redirect: 'error',
      signal: AbortSignal.any([
        ...init.signal ? [init.signal] : [],
        AbortSignal.timeout(15_000),
      ]),
    })
  } catch {
    throw Error('Remote tracker is unavailable')
  }
}
export let delivery =
  (remote: Remote, go: typeof fetch = fetch): Sink => async (rows) => {
    let response = await request(
      remote,
      'errors',
      new URLSearchParams({ scope: 'platform' }),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rows),
      },
      go,
    )
    await response.body?.cancel()
    if (!response.ok) {
      throw Error(`Remote tracker refused intake (${response.status})`)
    }
  }

/** Mark a Worker copy, returning false when the Worker does not hold it. */
export let mark = async (
  remote: Remote,
  bug: string,
  name: 'resolved' | 'archived',
  go: typeof fetch = fetch,
): Promise<boolean> => {
  let response = await request(
    remote,
    name == 'resolved' ? 'resolve' : 'archive',
    new URLSearchParams({ scope: 'platform' }),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bug }),
    },
    go,
  )
  if (response.status == 404) {
    let body = await response.json().catch(() => null)
    if (body?.error == 'bug not found') return false
  } else {
    await response.body?.cancel()
  }
  if (!response.ok) {
    throw Error(`Remote tracker refused the mark (${response.status})`)
  }
  return true
}
