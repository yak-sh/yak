// yaks.app signs in as a discovered MCP integration. A bot walks the same
// sign-in and consent pages, retaining its website session only in the vault.
import type { Graph } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { discover } from '@yaks/mcp-client/oauth'
import { registered, registration } from './clients.ts'
import { known } from './integrations.ts'
import { integrationEid } from './identity.ts'
import type { Vault } from '@yaks/secrets'
import type { AuthOptions, Callback } from './authorize.ts'
import { REDIRECT } from './signin.ts'
import { codeFor } from './signin-mail.ts'

let cookie = (headers: Headers) =>
  /(?:^|,\s*)yak_session=([^;,\s]+)/.exec(headers.get('set-cookie') ?? '')?.[1]
// The cookies a page set, as the next request's cookie header: a typed code
// signs in only the browser that asked for it (signin.ts `spend`).
let jar = (headers: Headers) =>
  headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
let unescape = (text: string) =>
  text.replaceAll('&amp;', '&').replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>')
let field = (html: string, name: string) => {
  let inputs = html.match(/<input\b[^>]*>/gi) ?? []
  for (let input of inputs) {
    if (new RegExp(`\\bname=["']${name}["']`).test(input)) {
      let value = /\bvalue=["']([^"']*)["']/.exec(input)?.[1]
      if (value != null) return unescape(value)
    }
  }
  throw new Error(`the consent page has no ${name}`)
}
let form = (
  go: typeof fetch,
  origin: string,
) =>
(path: string, fields: Record<string, string>, cookies = '') =>
  go(`${origin}${path}`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
      ...cookies ? { cookie: cookies } : {},
    },
    body: new URLSearchParams(fields),
  })

/** A website session for a bot, signed in at `origin` the way a person signs
 * in: it asks for a code, reads it from the letter this bot's graph received,
 * and spends it. No browser and nobody else is asked, so a bot whose session
 * lapsed signs itself in again. */
export let botSession = async (
  graph: Pick<Graph, 'read'>,
  origin: string,
  address: string,
  opts: { fetch?: typeof fetch; code?: typeof codeFor } = {},
): Promise<string> => {
  let post = form(opts.fetch ?? fetch, origin)
  let since = Date.now()
  let asked = await post('/login', { email: address })
  await asked.body?.cancel()
  if (asked.status != 200) {
    throw new Error(`the sign-in page refused: ${asked.status}`)
  }
  let code = await (opts.code ?? codeFor)(graph.read, address, since)
  let spent = await post(
    '/login/code',
    { email: address, code },
    jar(asked.headers),
  )
  let session = spent.status == 303 ? cookie(spent.headers) : undefined
  await spent.body?.cancel()
  if (!session) {
    throw new Error(
      `the sign-in code returned no website session: ${spent.status}`,
    )
  }
  return session
}

/** Spend the code sent to this bot's graph, then grant the OAuth request
 * through the page's own q and consent fields. Redirects are never followed
 * with a cookie or code, and the final return must name this flow's redirect. */
export let botCallback = async (
  graph: Pick<Graph, 'read'>,
  url: string,
  address: string,
  opts: { fetch?: typeof fetch; code?: typeof codeFor; session?: string } = {},
): Promise<Callback> => {
  let authorize = new URL(url), origin = authorize.origin
  let go = opts.fetch ?? fetch
  let post = form(go, origin)
  let session = opts.session ??
    await botSession(graph, origin, address, { fetch: go, code: opts.code })
  let page = await go(url, {
    headers: { cookie: `yak_session=${session}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  if (!page.ok) {
    await page.body?.cancel()
    throw new Error(`the authorize page refused: ${page.status}`)
  }
  let html = await page.text()
  let allowed = await post('/oauth/allow', {
    q: field(html, 'q'),
    consent: field(html, 'consent'),
  }, `yak_session=${session}`)
  let callback = allowed.headers.get('location')
  await allowed.body?.cancel()
  if (allowed.status != 302 && allowed.status != 303 || !callback) {
    throw new Error(`the consent page refused: ${allowed.status}`)
  }
  let target = new URL(callback),
    redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '')
  if (
    target.origin != redirect.origin || target.pathname != redirect.pathname
  ) {
    throw new Error('the consent page returned another redirect')
  }
  return { callback: target.href, session }
}
/** The discovery and unattended callback seams for the ordinary auth command.
 * A supplied session is for the held-cookie migration, not a terminal option. */
export let yaksApp = (
  h: { graph: Graph; vault: Vault },
  opts: {
    origin?: string
    fetch?: typeof fetch
    code?: typeof codeFor
    session?: string
  } = {},
): AuthOptions => {
  let origin = opts.origin ?? 'https://yaks.app'
  let go = opts.fetch ?? fetch
  return {
    fetch: go,
    offers: ['yaks.app'],
    prepare: async (name) => {
      if (name != 'yaks.app') return undefined
      let held = await known(h.graph.read, name)
      let clientName = `mcp ${origin}/mcp`
      if (!held || !await registered(h.vault, clientName)) {
        let found = await discover(`${origin}/mcp`, {}, go)
        let id = await found.register(REDIRECT)
        await h.graph.apply([
          {
            entity: { eid: integrationEid(name) },
            integration: {
              ...found.integration,
              name,
              title: 'yaks.app',
              site: origin,
              client: clientName,
            },
          },
          registration(clientName, { id }),
        ])
      }
      return { integration: name, redirect: REDIRECT }
    },
    callback: async (target, url, as) => {
      if (target.integration != 'yaks.app') return undefined
      if (!as && !opts.session) return undefined
      if (!opts.session && !as!.toLowerCase().endsWith('@bot.yak.sh')) {
        // --as selects accounts, it must not silently request mail we cannot read.
        return undefined
      }
      if (as && !as.includes('@')) {
        throw new Refused('signing in a bot needs its whole address')
      }
      return await botCallback(h.graph, url, as ?? '', { ...opts, fetch: go })
    },
  }
}
