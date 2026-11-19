import { COOKIE } from '@yaks/platform/cookie'
// Credential forwarding is a transport boundary: callers hold an address;
// only the process forwarding to the platform holds the account's sign-in.
export let FORWARDED = 'yak_admin_forward:'

export let forwarded = (
  url: string,
  credential: string | undefined,
  browser: boolean,
  init: RequestInit,
): { url: string; init: RequestInit } => {
  if (!credential?.startsWith(FORWARDED)) return { url, init }
  let headers = new Headers(init.headers)
  headers.delete('authorization')
  headers.delete('cookie')
  headers.set('x-yak-credential', browser ? 'session' : 'bearer')
  let target = new URL(credential.slice(FORWARDED.length))
  target.searchParams.set('url', url)
  return { url: target.href, init: { ...init, headers, redirect: 'error' } }
}

type Credentials = { bearer: string; session?: string }
export type Forwarding = {
  credential: () => Promise<Credentials>
  renewed: (session: string) => Promise<void>
  fetch?: typeof fetch
}

// These paths are served by the platform itself, never by uploaded app code.
let allowed = (url: URL) => {
  if (url.protocol != 'https:' || url.port || url.username || url.password) {
    return false
  }
  if (url.hostname == 'yaks.app') {
    return /^\/(?:mcp|invite|login\/link|api\/(?:fee|budget|comp|support|funnel|move|relocate|operator-copy|store-copy|graves|account|tunnel)|space\/[a-z0-9-]+\/delete)$/
      .test(url.pathname)
  }
  return /^[a-z0-9][a-z0-9-]*\.yaks\.app$/.test(url.hostname) &&
    /^\/(?:[a-z0-9][a-z0-9-]*\/)?api\/(?:query|apply|blob|pay\/artifacts(?:\/[a-f0-9]+)?)$/
      .test(url.pathname)
}

/** One private service's HTTP door. It never follows redirects or returns a
 * credential-bearing header. The account provider owns refresh and storage. */
export let forward = (doors: Forwarding) => async (request: Request) => {
  let target: URL
  try {
    target = new URL(new URL(request.url).searchParams.get('url') ?? '')
  } catch {
    return new Response('Choose a platform URL', { status: 400 })
  }
  let mode = request.headers.get('x-yak-credential')
  if (!allowed(target) || !['bearer', 'session'].includes(mode ?? '')) {
    return new Response('Choose a platform control door', { status: 403 })
  }
  let credentials = await doors.credential()
  let secret = mode == 'session' ? credentials.session : credentials.bearer
  if (!secret) {
    return new Response('The account has no website session', { status: 409 })
  }
  let headers = new Headers(request.headers)
  for (let key of ['authorization', 'cookie', 'host', 'x-yak-credential']) {
    headers.delete(key)
  }
  headers.set(
    mode == 'session' ? 'cookie' : 'authorization',
    mode == 'session' ? `${COOKIE}=${secret}` : `Bearer ${secret}`,
  )
  let response = await (doors.fetch ?? fetch)(target.href, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method)
      ? undefined
      : await request.arrayBuffer(),
    redirect: 'manual',
  })
  let renewed = new RegExp(`(?:^|,\\s*)${COOKIE}=([^;,\\s]+)`).exec(
    response.headers.get('set-cookie') ?? '',
  )?.[1]
  if (renewed && renewed != credentials.session) await doors.renewed(renewed)
  let answer = new Headers(response.headers)
  for (let key of ['set-cookie', 'authorization', 'cookie']) answer.delete(key)
  let secrets = [credentials.bearer, credentials.session, renewed].filter((
    v,
  ): v is string => !!v)
  let scrub = (text: string) =>
    secrets.reduce(
      (text, secret) => text.replaceAll(secret, '[redacted]'),
      text,
    )
  for (let [key, value] of answer) answer.set(key, scrub(value))
  let textual = /json|text|javascript|xml/.test(
    answer.get('content-type') ?? '',
  )
  let body = textual ? scrub(await response.text()) : response.body
  answer.delete('content-length')
  answer.delete('content-encoding')
  return new Response([204, 205, 304].includes(response.status) ? null : body, {
    status: response.status,
    headers: answer,
  })
}
