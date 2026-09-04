// yaks.app as a client speaks it: the sign-in card, the connector, and an
// app's two store doors. Everything here is something a person could do in a
// browser — there is no operator authority in this file and no door a signed-in
// account does not already have.
//
// The sign-in code has two lives and this module knows both. To a
// `@bot.yak.sh` address the letter lands in the TASKS graph, where the fleet
// sweep files it as a `mail` entity, so `codeFor` waits on the graph and reads
// the digits out of the subject. To anyone else's address it lands in their
// mail, which no program here can open, so the code is asked for.
//
// The platform's own spellings are imported, never retyped: `PLATFORM` from
// the router, `COOKIE` from the token. A drift on either side is a type error
// rather than a puzzling 401.
import { PLATFORM } from '../workers/yak/route.ts'
import { COOKIE } from './token.ts'
import { type Querier, query as graphQuery, type Row } from './client.ts'

// The zone this client points at, so a probe can aim somewhere else.
export let zone = () => Deno.env.get('YAKS_ZONE') ?? PLATFORM

export let apex = (path: string) => `https://${zone()}${path}`

// Where an app's store answers. `<space>/<app>` names one app;
// a bare `<space>` is the space's front page, whose api lives at the
// hostname's own root (workers/yak/apps.ts `front`).
export let storeUrl = (at: string, path: string, host = zone()) => {
  let [space, app] = at.split('/')
  if (!space) throw new Error(`no space in "${at}" — try jeff/recipes`)
  return `https://${space}.${host}${app ? `/${app}` : ''}/api${path}`
}

let head = (session: string) => ({ cookie: `${COOKIE}=${session}` })

// The claims a session carries, read WITHOUT the secret: the body half is
// plain base64url JSON (src/token.ts), so a client can say whose session it
// holds and when it dies without asking the platform. Unverifiable here by
// design — the platform is the only one that can say a token is good.
export type Claims = { person: string; space: string | null; exp: number }

export let claimsOf = (session: string): Claims | null => {
  try {
    let body = session.slice(0, session.lastIndexOf('.'))
    let json = atob(body.replaceAll('-', '+').replaceAll('_', '/'))
    let c = JSON.parse(json)
    return typeof c?.person == 'string' ? c : null
  } catch {
    return null
  }
}

// The cookie the sign-in card set, out of the response's own header.
export let cookieOf = (setCookie: string | null): string | null => {
  let m = new RegExp(`(?:^|,\\s*)${COOKIE}=([^;,\\s]+)`).exec(setCookie ?? '')
  return m ? m[1] : null
}

let form = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString()

let posted = (url: string, fields: Record<string, string>, session?: string) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(session ? head(session) : {}),
    },
    body: form(fields),
  })

// Ask for a code. The card answers the same bytes whether or not a letter
// went out (identity.ts, T-33020), so there is nothing to read back but the
// status — a refusal here is a broken door, not a refused address.
export let askCode = async (address: string) => {
  let r = await posted(apex('/login'), { email: address })
  if (r.status != 200) throw new Error(`/login said ${r.status}`)
  await r.body?.cancel()
}

// Spend a code. The session is the cookie on the redirect; a wrong or expired
// code comes back as the card again, which is a 400.
export let spendCode = async (address: string, code: string) => {
  let r = await posted(apex('/login/code'), { email: address, code })
  let session = cookieOf(r.headers.get('set-cookie'))
  await r.body?.cancel()
  if (!session) {
    throw new Error(
      r.status == 400
        ? 'that code has expired or was mistyped'
        : `/login/code said ${r.status} and set no session`,
    )
  }
  return session
}

let SUBJECT = /\b(\d{6})\b is your yaks\.app code/

// The digits out of the letters the graph holds for an address. Newest first,
// and only letters that arrived since the ask — an old code still on file
// would be spent against a fresh mac and fail (signin.ts keeps a mac, never
// the digits).
export let codeIn = (rows: Row[], address: string, since: number) => {
  let seen = rows
    .map((r) => ({
      code: SUBJECT.exec(String(r.comps.doc?.title ?? ''))?.[1],
      to: String(r.comps.mail?.to_addr ?? ''),
      at: Date.parse(String(r.comps.mail?.received_at ?? '')),
    }))
    .filter((m) => m.code && m.to == address && m.at >= since)
    .sort((a, b) => b.at - a.at)
  return seen[0]?.code ?? null
}

// The fleet sweep files inbound mail every ten seconds (doing.ts), so a code
// takes a few of them to arrive. Polls the graph rather than any mail API:
// the graph is where the letter ends up and the only place this box can read
// it from.
export let codeFor = async (
  address: string,
  since: number,
  opts: { wait?: number; poll?: number; query?: Querier } = {},
) => {
  let ask = opts.query ?? graphQuery
  let deadline = Date.now() + (opts.wait ?? 90_000)
  for (;;) {
    let rows = await ask(['.kind=mail'], { limit: 40 })
    let code = codeIn(rows, address, since)
    if (code) return code
    if (Date.now() > deadline) {
      throw new Error(
        `no code for ${address} in the graph after ${
          Math.round((opts.wait ?? 90_000) / 1000)
        }s — is the tasks server up and sweeping inbound mail?`,
      )
    }
    await new Promise((go) => setTimeout(go, opts.poll ?? 3_000))
  }
}

// The connector, as JSON-RPC over one POST. Stateless: /mcp answers a
// tools/call with no initialize handshake, which is what makes a CLI call
// cost one round trip.
export let rpc = (session: string) => {
  let n = 0
  return async (method: string, params: unknown = {}) => {
    let r = await fetch(apex('/mcp'), {
      method: 'POST',
      headers: { ...head(session), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }),
    })
    if (r.status != 200) {
      throw new Error(`/mcp said ${r.status}: ${await r.text()}`)
    }
    let reply = await r.json()
    if (reply.error) {
      throw new Error(`${reply.error.code}: ${reply.error.message}`)
    }
    return reply.result
  }
}

export type Content = { type: string; text?: string }

// What a tool SAID, not the envelope it said it in. An erring tool throws
// with its own words, so a caller reads one sentence either way.
export let saidBy = (out: { content?: Content[]; isError?: boolean }) => {
  let text = (out.content ?? [])
    .map((c) => c.text ?? `[${c.type}]`)
    .join('\n')
  if (out.isError) throw new Error(text || 'the tool erred and said nothing')
  return text
}

export let tool = async (session: string, name: string, args: unknown) =>
  saidBy(await rpc(session)('tools/call', { name, arguments: args }))

export let tools = async (session: string) =>
  (await rpc(session)('tools/list')).tools as {
    name: string
    description: string
  }[]

// A tool argument off the command line: `key=value`, JSON when it parses as
// JSON so numbers, booleans and objects survive, and the plain string
// otherwise — the same forgiveness the dot-param grammar shows a writer.
export let argOf = (word: string): [string, unknown] => {
  let eq = word.indexOf('=')
  if (eq <= 0) throw new Error(`not a tool argument: ${word} (want key=value)`)
  let key = word.slice(0, eq)
  let raw = word.slice(eq + 1)
  try {
    return [key, JSON.parse(raw)]
  } catch {
    return [key, raw]
  }
}

export let argsOf = (words: string[]) =>
  Object.fromEntries(words.map(argOf)) as Record<string, unknown>

let bodyOf = async (r: Response) => {
  let text = await r.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// The filter grammar over an app's store — the same line the page's own
// client.js sends, each segment encoded whole the way client.ts queryArgs
// does it.
export let storeQuery = async (
  session: string,
  at: string,
  filters: string[],
) => {
  let url = `${storeUrl(at, '/query')}?${
    filters.map(encodeURIComponent).join('&')
  }`
  let r = await fetch(url, { headers: head(session) })
  let body = await bodyOf(r)
  if (!r.ok) throw new Error(`${at} refused the query: ${JSON.stringify(body)}`)
  return body
}

export let storeApply = async (
  session: string,
  at: string,
  batch: unknown,
) => {
  let r = await fetch(storeUrl(at, '/apply'), {
    method: 'POST',
    headers: { ...head(session), 'content-type': 'application/json' },
    body: JSON.stringify(batch),
  })
  let body = await bodyOf(r)
  if (!r.ok) throw new Error(`${at} refused the write: ${JSON.stringify(body)}`)
  return body
}

export type Me = {
  person: string | null
  name: string | null
  role: string | null
  reads: boolean
  writes: boolean
}

// Who the platform says this session is, in one app's space. It is the only
// client door that answers a ROLE, so a space with no app in it has no way to
// be asked — `whoami` says so rather than guessing.
export let meAt = async (session: string, at: string): Promise<Me | null> => {
  let r = await fetch(storeUrl(at, '/me'), { headers: head(session) })
  if (!r.ok) {
    await r.body?.cancel()
    return null
  }
  let body = await bodyOf(r)
  return typeof body == 'object' ? body as Me : null
}

// ── Closing a space (workers/yak/erase.ts, T-33166) ────────────────────────
//
// The delete door is the signed-in WEB surface — it reads the session cookie
// and never a bearer, so an agent's connector token cannot reach it — and
// what it takes is a page and a form. This client holds a cookie because a
// person signed this box in, so it walks that same page: read what would go,
// then type the name back.

// The h1 and the paragraph under it, off one of the kernel's own pages
// (workers/yak/pages.ts `shell`): what the page SAYS, without a parser.
export let saidOn = (html: string) => {
  let m = /<h1>([^<]*)<\/h1><p>([^<]*)<\/p>/.exec(html)
  return m ? { title: m[1], lead: m[2] } : { title: '', lead: '' }
}

// And the list of what a delete would destroy, which the page draws as one
// item per line.
export let listedOn = (html: string) =>
  [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1])

// The page escapes everything it interpolates (pages.ts `esc`), so reading it
// back means undoing exactly that — `&` last, the mirror of escaping it first.
export let plain = (s: string) =>
  s.replaceAll('&#39;', "'").replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&')

// What a page answered, or the reason it would not: a refusal is a sentence
// on the page itself, and 302 and 404 are the two answers that carry none.
let read = (status: number, html: string) => {
  if (status == 302) throw new Error('this account is not signed in')
  if (status == 404) {
    throw new Error('no such space, or not this account\u2019s')
  }
  let { lead } = saidOn(html)
  if (status != 200) throw new Error(plain(lead) || `the door said ${status}`)
  return plain(lead)
}

// What deleting this space would destroy, as the page names it. A GET only
// ever draws (identity.ts `closing`), so asking changes nothing.
export let doomedIn = async (session: string, slug: string) => {
  let r = await fetch(apex(`/space/${slug}/delete`), {
    headers: head(session),
    redirect: 'manual',
  })
  let html = await r.text()
  read(r.status, html)
  return listedOn(html).map(plain)
}

// The act, with the slug typed back into the form — which is what this
// client\u2019s argument is. Answers the sentence the page says afterwards.
export let close = async (session: string, slug: string) => {
  let r = await posted(
    apex(`/space/${slug}/delete`),
    { confirm: slug },
    session,
  )
  return read(r.status, await r.text())
}
