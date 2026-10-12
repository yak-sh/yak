// The box shares one signed tracker transport for reads, intake and bug marks.
// Credentials are read at use time and never reach redirects or error text.
import { derivedEid } from '@yaks/graph/identity'
import type { Sink } from './report.ts'
import { sign } from './ticket.ts'

export type Remote = { url?: string; secret?: string }

/** A failure a timeout caused. It is named as one; any other failure names no
 * cause, since a cause can carry the address or the upstream's body. */
export let late = (error: unknown) =>
  error instanceof DOMException && error.name == 'TimeoutError'

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
    ...['resolve', 'archive', 'take', 'deployed'].includes(path)
      ? { mark: true }
      : {},
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
  } catch (error) {
    throw late(error)
      ? new DOMException(
        'Remote tracker did not answer in time',
        'TimeoutError',
      )
      : Error('Remote tracker is unavailable')
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

// The Worker's door for each mark, by the mark's name.
let doors = { resolved: 'resolve', archived: 'archive', taken: 'take' }

/** Mark a Worker copy, returning false when the Worker does not hold it. A
 * `taken` mark names the fixer's `task`. */
export let mark = async (
  remote: Remote,
  bug: string,
  name: keyof typeof doors,
  go: typeof fetch = fetch,
  task?: string,
): Promise<boolean> => {
  let response = await request(
    remote,
    doors[name],
    new URLSearchParams({ scope: 'platform' }),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(task ? { bug, task } : { bug }),
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
