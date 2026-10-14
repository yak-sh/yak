// The mail seam (D-32318 §Not tied to Cloudflare): one letter out, two
// adapters. Nothing above this line knows how a letter travels — identity.ts
// asks for `mail(env, store)` and calls it.
//
// `sending` is the hosted adapter: Cloudflare Email Sending through @yaks/mail's
// one client for it (`deliver`), with a payload of its own: a display name,
// every reader on one send, and a Reply-To that is not the sender. These
// letters have no row behind them to retry from (a sign-in code is never
// written down), so a letter that never left, which `deliver` says by
// rejecting as `Unsent` (no connection, a 429), is tried again here, a few
// times and briefly, while somebody waits for it. Any other failure may have
// left, and is thrown at once: a letter is sent at most once.
//
// `printed` is the local adapter: the letter on the Worker's own log, where
// whoever is running `wrangler dev` reads it (and a probe reads it out of the
// captured output). It is chosen only when MAIL_DEV says so: a deploy missing
// its mail secrets fails loudly at the send rather than quietly filing
// everybody's codes where they can be read. A code is a key, and a key is
// never written down: nothing in any store holds one in a form that opens
// anything (signin.ts keeps a mac of it, never the digits), so a read of the
// graph — however it is reached — can never mint a session (T-32585).
import type { Env } from './env.ts'
import { esc } from './html.ts'
import { deliver, type Payload, Unsent } from '@yaks/mail'

// `to` is one address or several. Email Sending takes a list, and one send to
// several recipients is one letter: it either reaches every reader or none, so
// a caller never has to say which half of a delivery worked.
//
// `replyTo` is where an answer goes: the platform's own address (host.ts
// `replyTo`) unless the letter is about somebody who should hear it directly —
// a person's feedback is answered to the person, not to ourselves.
export type Letter = {
  to: string | string[]
  subject: string
  body: string
  replyTo?: string
}
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

// How often a letter that never left is tried, and the longest wait between
// tries whatever the API asks: somebody is waiting on a sign-in code.
let TRIES = 3
let PAUSE = 2000
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export let sending = (
  token: string,
  account: string,
  api: string,
  env: Host = {},
  pause = sleep,
): Mail => {
  // The global fetch, looked up at each call rather than held unbound.
  let post = deliver({
    account,
    token,
    base: api,
    fetch: (u, i) => fetch(u, i),
  })
  return async (l) => {
    if (!token || !account) throw new Error('mail is not configured')
    let body: Payload = {
      from: { address: FROM, name: 'yaks.app' },
      to: [l.to].flat(),
      reply_to: l.replyTo ?? replyTo(env),
      subject: l.subject,
      text: l.body,
      html: `<p>${esc(l.body).replaceAll('\n\n', '</p><p>')}</p>`,
    }
    for (let tried = 1;; tried++) {
      try {
        await post(body)
        return
      } catch (e) {
        if (!(e instanceof Unsent) || tried >= TRIES) throw e
        await pause(Math.min(e.retry.after, PAUSE))
      }
    }
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
// Sending with its token and an account. A door asks before it mints what the
// letter would carry, so a deploy missing its mail secret answers in one
// sentence (identity.ts `/login`) instead of a 500 after the fact.
export let mailable = (
  env: Pick<Env, 'MAIL_DEV' | 'MAIL_TOKEN' | 'MAIL_ACCOUNT' | 'CF_ACCOUNT'>,
) => env.MAIL_DEV == '1' || !!(env.MAIL_TOKEN && account(env))

// What sending reads off the env, so a store's effect, which holds the
// Worker's bindings as a partial env (graph.ts `Bindings`), sends the same way
// a request does.
type Posting = Pick<
  Env,
  | 'MAIL_DEV'
  | 'MAIL_SINK'
  | 'MAIL_TOKEN'
  | 'MAIL_ACCOUNT'
  | 'MAIL_API'
  | 'CF_ACCOUNT'
  | 'APEX'
  | 'LOCAL_DEV'
>

export let mail = (env: Posting): Mail => {
  let send = env.MAIL_DEV == '1' ? printed() : sending(
    env.MAIL_TOKEN ?? '',
    account(env),
    env.MAIL_API ?? API,
    env,
  )
  return (letter) =>
    send({ ...letter, ...sink(env, letter.to, letter.subject) })
}
