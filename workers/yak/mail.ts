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
import { esc } from './pages.ts'

export type Letter = { to: string; subject: string; body: string }
export type Mail = (l: Letter) => Promise<void>

// Who the platform writes as. The envelope sender must be an address the
// fleet's Email Sending domain (src/mailaddr.ts `mailDomain`, bot.yak.sh —
// DKIM signed, SPF/DMARC on cf-bounce.bot.yak.sh) is authorized to send;
// yaks.app has no Email Sending setup, so a letter from there is refused at
// the API. The reader still answers the platform: REPLY_TO is the yaks.app
// address, and the display name is the platform's. A space that white-labels
// its login will want its own pair; that is a later leaf's.
export let FROM = 'hello@bot.yak.sh'
export let REPLY_TO = 'hello@yaks.app'

// One line, JSON, tagged: a person reads it at a glance and a probe parses
// the letter back out of the log (probe.ts `mailed`).
export let printed = (): Mail => (l) => {
  console.log(`yak-mail ${JSON.stringify({ from: FROM, ...l })}`)
  return Promise.resolve()
}

export let sending =
  (token: string, account: string, api: string): Mail => async (l) => {
    if (!token || !account) throw new Error('mail is not configured')
    let res = await fetch(`${api}/accounts/${account}/email/sending/send`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: { address: FROM, name: 'yaks.app' },
        to: [l.to],
        reply_to: REPLY_TO,
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

export let mail = (env: Env): Mail =>
  env.MAIL_DEV == '1' ? printed() : sending(
    env.MAIL_TOKEN ?? '',
    env.MAIL_ACCOUNT ?? '',
    env.MAIL_API ?? API,
  )
