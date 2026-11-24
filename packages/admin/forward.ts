import { mapped, packet, readAsk, WIRE } from '@yaks/platform/browser-wire'
import { COOKIE } from '@yaks/platform/cookie'
import { ADMIN_BROWSE, adminPage, BROWSE } from '@yaks/platform/routes'
import { ICONS } from '@yaks/platform/app-icon'
export { FORWARDED, forwarded } from '@yaks/cli/account-forward'

type Credentials = { bearer: string; session?: string }
export type Forwarding = {
  credential: () => Promise<Credentials>
  renewed: (session: string) => Promise<void>
  fetch?: typeof fetch
  browseFetch?: typeof fetch
}

// These paths are served by the platform itself, never by uploaded app code.
let allowed = (url: URL) => {
  if (url.protocol != 'https:' || url.port || url.username || url.password) {
    return false
  }
  if (url.hostname == 'yaks.app') {
    return url.pathname == ICONS ||
      /^\/(?:mcp|invite|login\/link|api\/(?:fee|budget|comp|spaces|support|funnel|move|relocate|operator-copy|operator-graph|store-copy|graves|uses|account|tunnel)|space\/[a-z0-9-]+\/delete)$/
        .test(url.pathname)
  }
  return /^[a-z0-9][a-z0-9-]*\.yaks\.app$/.test(url.hostname) &&
    /^\/(?:[a-z0-9][a-z0-9-]*\/)?api\/(?:query|apply|blob|vocab|pay\/artifacts(?:\/[a-f0-9]+)?)$/
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
  let browsing = target.href == `https://yaks.app${BROWSE}`
  if (
    browsing
      ? request.method != 'POST' || mode != 'session'
      : !allowed(target) || !['bearer', 'session'].includes(mode ?? '')
  ) {
    return new Response('Choose a platform control door', { status: 403 })
  }
  if (browsing && request.headers.get('content-type') == WIRE) {
    let file = await readAsk<{ url: string }>(request.body).catch(() => null)
    if (!file || !adminPage(file.head.url)) {
      await file?.close()
      return new Response('Choose an /admin page on yaks.app', { status: 403 })
    }
    try {
      let response = await adminVisit(doors, request, target, packet(file))
      if (response.status >= 400) await file.close()
      return response
    } catch (e) {
      await file.close()
      throw e
    }
  }
  let body = ['GET', 'HEAD'].includes(request.method)
    ? undefined
    : await request.arrayBuffer()
  if (browsing) {
    if (!adminPage(browsePage(body!))) {
      return new Response('Choose an /admin page on yaks.app', { status: 403 })
    }
    return adminVisit(doors, request, target, body!)
  }
  return delegated(doors, request, target, mode, body)
}

let adminVisit = (
  doors: Forwarding,
  request: Request,
  target: URL,
  body: BodyInit,
) => {
  // This route uses the OAuth grant and issues a short-lived admin cookie.
  target.pathname = ADMIN_BROWSE
  return delegated(doors, request, target, 'bearer', body)
}

let delegated = async (
  doors: Forwarding,
  request: Request,
  target: URL,
  mode: string | null,
  body: BodyInit | undefined,
) => {
  let credentials = await doors.credential()
  let secret = mode == 'session' ? credentials.session : credentials.bearer
  if (!secret) {
    return new Response('The account has no website session', { status: 409 })
  }
  let response = await sendTo(doors, request, target, mode, secret, body)
  return relay(doors, response, credentials)
}

let browsePage = (body: ArrayBuffer): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(body))?.url
  } catch {
    return null
  }
}

let sendTo = (
  doors: Forwarding,
  request: Request,
  target: URL,
  mode: string | null,
  secret: string,
  body: BodyInit | undefined,
) => {
  let headers = new Headers(request.headers)
  for (let key of ['authorization', 'cookie', 'host', 'x-yak-credential']) {
    headers.delete(key)
  }
  if (body instanceof ReadableStream) headers.delete('content-length')
  // A session rides as both cookies a signed-in browser holds, as the
  // direct client sends it (api.ts `head`): the apex reads only its own once
  // the shared one stops being honored there.
  headers.set(
    mode == 'session' ? 'cookie' : 'authorization',
    mode == 'session'
      ? `${COOKIE}=${secret}; __Host-${COOKIE}=${secret}`
      : `Bearer ${secret}`,
  )
  let browser = target.pathname == ADMIN_BROWSE ? doors.browseFetch : undefined
  let send = browser ?? doors.fetch ?? fetch
  return send(target.href, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
    signal: browser ? request.signal : undefined,
  })
}

let relay = async (
  doors: Forwarding,
  response: Response,
  credentials: Credentials,
) => {
  let renewed = new RegExp(`(?:^|,\\s*)${COOKIE}=([^;,\\s]+)`).exec(
    response.headers.get('set-cookie') ?? '',
  )?.[1]
  if (renewed && renewed != credentials.session) {
    await doors.renewed(renewed)
  }
  let answer = new Headers(response.headers)
  for (let key of ['set-cookie', 'authorization', 'cookie']) answer.delete(key)
  let secrets = [credentials.bearer, credentials.session, renewed]
    .filter((
      v,
    ): v is string => !!v)
  let scrub = (text: string) =>
    secrets.reduce(
      (text, secret) => text.replaceAll(secret, '[redacted]'),
      text,
    )
  for (let [key, value] of answer) answer.set(key, scrub(value))
  let type = answer.get('content-type') ?? ''
  let body = type == WIRE
    ? mapped(response.body, (head) => JSON.parse(scrub(JSON.stringify(head))))
    : /json|text|javascript|xml/.test(type)
    ? scrub(await response.text())
    : response.body
  answer.delete('content-length')
  answer.delete('content-encoding')
  return new Response([204, 205, 304].includes(response.status) ? null : body, {
    status: response.status,
    headers: answer,
  })
}
