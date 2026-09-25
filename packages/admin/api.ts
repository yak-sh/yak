// yaks.app as a client speaks it: the sign-in card, the connector, an app's
// two store doors, and the platform's own fee. Everything here is something a
// person could do in a browser — this file holds no credential of its own and
// asks for nothing an account's session does not already carry. The fee door
// is not an exception: it answers to a SEAT in the `yak` space, read off the
// same cookie as everything else, so what makes it the owner's is their
// membership and never something kept here.
//
// The sign-in code has two lives and this module knows both. To a
// `@bot.yak.sh` address the letter lands in the graph this box's `yak` opens,
// where @yaks/mail's pull files it as a `mail` entity, so `codeFor` waits on
// that graph and reads the digits out of the subject. To anyone else's
// address it lands in their mail, which no program here can open, so the
// code is asked for.
//
// The platform's own names are imported, never retyped: `PLATFORM` from the
// router, `COOKIE` from the token. A drift on either side is a type error
// rather than a puzzling 401.
import type { Bundle, Comp } from '@yaks/graph'
import { timed } from '@yaks/cli'
import { type And, and, eq, ge, limit, want } from '@yaks/query'
import { LINK } from '../../workers/yak/link.ts'
import { PLATFORM_STORE } from '../../workers/yak/door.ts'
import { PLATFORM } from '../../workers/yak/route.ts'
import { COOKIE } from '../../workers/yak/lib/token.ts'

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
// plain base64url JSON (workers/yak/lib/token.ts), so a client can say whose session it
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

// A session the platform RENEWED, told to whoever is keeping it (T-35380).
// The platform slides a cookie past half its life (workers/yak/identity.ts
// `slid`), so any answer here may carry a new value for the same account, and
// a client that dropped it would sign this box out ninety days after its
// first sign-in however busy it had been. This module holds no credential and
// must not learn where one lives, so it hands the value on: ./tools.ts writes
// it back into the vault.
let told: (fresh: string) => void = () => {}

export let renewing = (note: (fresh: string) => void) => (told = note)

// `yak --timing` (or YAKS_TIMING=1): one line on stderr per response, the
// same line @yaks/cli prints for the connector door. Read off the command
// line this process was started with, since these calls go to the apex
// rather than through the door the flag was parsed for.
export let timing = {
  on: Deno.args.includes('--timing') || Deno.env.get('YAKS_TIMING') == '1',
  say: (line: string) => console.error(line),
}

// EVERY call this client makes: the account's cookie goes out here, a renewed
// one is read back here, and `yak --timing` says its line here, so no verb
// has to think about any of the three.
let sent = async (
  url: string,
  session?: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
) => {
  let asked = {
    ...init,
    headers: { ...init.headers, ...(session ? head(session) : {}) },
  }
  let go = () => fetch(url, asked)
  let r = timing.on
    ? await timed(timing.say, go)(new Request(url, asked))
    : await go()
  let fresh = session ? cookieOf(r.headers.get('set-cookie')) : null
  if (fresh && fresh != session) told(fresh)
  return r
}

let form = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString()

let posted = (url: string, fields: Record<string, string>, session?: string) =>
  sent(url, session, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
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

/** What minting a standing link answers: the URL, the id that revokes it, when
 * it dies, and every one this account still has standing. */
export type Link = {
  url: string
  id: string
  expires: string
  links: string[]
}

// A STANDING sign-in link for this account (workers/yak/link.ts): one URL that
// signs its holder in until it expires, which is what an app directory's
// reviewer is given instead of a mailbox. Still no operator authority — a link
// is worth a session and nothing more, and the cookie this call is made with is
// the longer-lived credential of the two.
export let linkFor = (session: string, days?: number): Promise<Link> =>
  said(posted(apex(LINK), days ? { days: String(days) } : {}, session))

/** Taking one back, by its id or the front of one. Answers the ids that went. */
export let unlink = async (session: string, id: string): Promise<string[]> =>
  (await said<{ revoked: string[] }>(
    posted(apex(LINK), { revoke: id }, session),
  )).revoked

/** What the platform takes from a sale, in basis points, and the rate as a
 * person reads it (workers/yak/sell.ts `fees`). */
export type Fee = { bps: number; rate: string }

export let FEE = '/api/fee'

/** The rate as it stands. Any signed-in account may ask; only an owner of the
 * `yak` space is answered. */
export let feeNow = (session: string): Promise<Fee> =>
  said(sent(apex(FEE), session))

/** Set it. Whole basis points — 250 is 2.5%, 0 takes nothing. */
export let setFee = (session: string, bps: number): Promise<Fee> =>
  said(posted(apex(FEE), { bps: String(bps) }, session))

// The doors answer JSON both ways: a refusal says why in the same shape every
// other door here refuses in (identity.ts `unauthorized`). The path is read
// back off the answer, so a new door's failure names itself.
let said = async <T>(answer: Promise<Response>): Promise<T> => {
  let r = await answer
  let body = await bodyOf(r)
  if (!r.ok) {
    throw new Error(
      body?.error?.message ?? `${new URL(r.url).pathname} said ${r.status}`,
    )
  }
  return body as T
}

let SUBJECT = /\b(\d{6})\b is your yaks\.app code/

let prop = (b: Bundle, comp: string, name: string): unknown =>
  (b[comp] as Comp | undefined)?.[name]

// The digits out of the letters the graph holds for an address. Newest first,
// and only letters that arrived since the ask — an old code still on file
// would be spent against a fresh mac and fail (signin.ts keeps a mac, never
// the digits).
export let codeIn = (letters: Bundle[], address: string, since: number) => {
  let seen = letters
    .map((b) => ({
      code: SUBJECT.exec(String(prop(b, 'doc', 'title') ?? ''))?.[1],
      to: String(prop(b, 'mail', 'to') ?? ''),
      at: Date.parse(String(prop(b, 'mail', 'at') ?? '')),
    }))
    .filter((m) => m.code && m.to == address && m.at >= since)
    .sort((a, b) => b.at - a.at)
  return seen[0]?.code ?? null
}

// The letters for one address since the ask. The graph holds thousands of
// letters, so the filter names the recipient and the window: an unfiltered
// window of the newest few reads other mail and misses this one. The code is
// in the subject, so the letter's `doc` is asked for beside its `mail`.
export let lettersFor = (address: string, since: number): And =>
  and(
    eq('mail.to', address),
    ge('mail.at', new Date(since).toISOString()),
    want('doc'),
    limit(10),
  )

// @yaks/mail's pull files inbound mail each time its duty comes round, so a
// code takes a few passes to arrive. Polls the graph rather than any mail
// API: the graph is where the letter ends up and the only place this box can
// read it from.
export let codeFor = async (
  read: (q: And) => Bundle[] | Promise<Bundle[]>,
  address: string,
  since: number,
  opts: { wait?: number; poll?: number } = {},
) => {
  let deadline = Date.now() + (opts.wait ?? 90_000)
  for (;;) {
    let code = codeIn(await read(lettersFor(address, since)), address, since)
    if (code) return code
    if (Date.now() > deadline) {
      throw new Error(
        `no code for ${address} in the graph after ${
          Math.round((opts.wait ?? 90_000) / 1000)
        }s — is a \`yak serve\` pulling inbound mail (@yaks/mail \`pull\`)?`,
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
    let r = await sent(apex('/mcp'), session, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

let bodyOf = async (r: Response) => {
  let text = await r.text()
  return valueOf(text)
}

let valueOf = (text: string) => {
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
  // The directory is deliberately not served as an app (apps.ts `kernels`):
  // its owner's public door is the graph tier, where naming yak/platform
  // carries the same account to the store without exposing a kernel URL.
  if (at == PLATFORM_STORE) {
    let answer = await rpc(session)('tools/call', {
      name: 'graph_query',
      arguments: { app: at, query: filters.join('&') },
    })
    return valueOf(saidBy(answer))
  }
  let url = `${storeUrl(at, '/query')}?${
    filters.map(encodeURIComponent).join('&')
  }`
  let r = await sent(url, session)
  let body = await bodyOf(r)
  if (!r.ok) throw new Error(`${at} refused the query: ${JSON.stringify(body)}`)
  return body
}

// An app's `/me` (workers/yak/apps.ts) is deliberately absent from this file.
// It answers for ONE app's store, so asking it a question about the person —
// their role — cost a round trip per space and woke a Durable Object to say
// what the directory already knew. `app_list` answers the role beside each
// space (T-35384); ask an app only what only an app knows.

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
  let r = await sent(apex(`/space/${slug}/delete`), session, {
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
