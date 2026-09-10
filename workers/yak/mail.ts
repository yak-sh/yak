// The mail seam (D-32318 §Not tied to Cloudflare): one letter out, two
// adapters. Nothing above this line knows how a letter travels — identity.ts
// asks for `mail(env, store)` and calls it.
//
// `sending` is the hosted adapter: Cloudflare Email Sending, the same payload
// shape src/mailer.ts `payload`/`send` post from the Deno server (from/name,
// to, reply_to, subject, text, html). It is written out rather than imported
// because that module reads `Deno.env` and renders its html through md.ts's
// markdown door — a whole vendored parser for a six-digit code that has no
// markup in it. A change to the API's shape is a change to both.
//
// `printed` is the local adapter: the letter on the Worker's own log, where
// whoever is running `wrangler dev` reads it (and a probe reads it out of the
// captured output). It is chosen ONLY when MAIL_DEV says so: a deploy missing
// its mail secrets fails loudly at the send rather than quietly filing
// everybody's codes where they can be read. A code is a key, and a key is
// never written down: nothing in any store holds one in a form that opens
// anything (signin.ts keeps a mac of it, never the digits), so a read of the
// graph — however it is reached — can never mint a session (T-32585).
import type { Env } from './env.ts'
import { esc } from './html.ts'

// `to` is one address or several. Email Sending takes a list, and one send to
// several recipients is ONE letter: it either reaches every reader or none, so
// a caller never has to say which half of a delivery worked.
export type Letter = { to: string | string[]; subject: string; body: string }
export type Mail = (l: Letter) => Promise<void>

import { FROM } from './mail-config.ts'
import { sink } from './post.ts'
import { type Host, replyTo } from './host.ts'
export { FROM, GRAPH, REPLY_TO } from './mail-config.ts'

// One line, JSON, tagged: a person reads it at a glance and a probe parses
// the letter back out of the log (probe.ts `mailed`).
export let printed = (): Mail => (l) => {
  console.log(`yak-mail ${JSON.stringify({ from: FROM, ...l })}`)
  return Promise.resolve()
}

export let sending =
  (token: string, account: string, api: string, env: Host = {}): Mail =>
  async (l) => {
    if (!token || !account) throw new Error('mail is not configured')
    let res = await fetch(`${api}/accounts/${account}/email/sending/send`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: { address: FROM, name: 'yaks.app' },
        to: [l.to].flat(),
        reply_to: replyTo(env),
        subject: l.subject,
        text: l.body,
        html: `<p>${esc(l.body).replaceAll('\n\n', '</p><p>')}</p>`,
      }),
    })
    if (!res.ok) {
      throw new Error(
        `mail failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`,
      )
    }
  }

let API = 'https://api.cloudflare.com/client/v4'

// The account the token sends on is the account the Worker runs on, so
// CF_ACCOUNT (a var in wrangler.toml, never a secret) stands in when
// MAIL_ACCOUNT is unset: one secret per deploy instead of a pair, and a
// staging deploy cannot set half of it.
export let account = (env: Pick<Env, 'MAIL_ACCOUNT' | 'CF_ACCOUNT'>) =>
  env.MAIL_ACCOUNT || env.CF_ACCOUNT || ''

// Whether a letter can leave this deploy at all: the local adapter, or Email
// Sending with its token and an account. A door asks BEFORE it mints what the
// letter would carry, so a deploy missing its mail secret answers in one
// sentence (identity.ts `/login`) instead of a 500 after the fact.
export let mailable = (
  env: Pick<Env, 'MAIL_DEV' | 'MAIL_TOKEN' | 'MAIL_ACCOUNT' | 'CF_ACCOUNT'>,
) => env.MAIL_DEV == '1' || !!(env.MAIL_TOKEN && account(env))

export let mail = (env: Env): Mail => {
  let send = env.MAIL_DEV == '1' ? printed() : sending(
    env.MAIL_TOKEN ?? '',
    account(env),
    env.MAIL_API ?? API,
    env,
  )
  return (letter) =>
    send({ ...letter, ...sink(env, letter.to, letter.subject) })
}
