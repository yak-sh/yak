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
// `kept` is the local adapter: the letter as an entity in the meta store —
// `doc` (subject, body) plus `mail` (from, to_addr), the graph's own outbound
// vocabulary — so a local run reads its own codes out of the graph and no
// second channel exists. It is chosen ONLY when MAIL_DEV says so: a deploy
// missing its mail secrets fails loudly at the send rather than quietly
// filing everybody's codes where they can be read.
import type { Env } from './env.ts'
import { esc } from './pages.ts'
import type { Door } from './store.ts'

export type Letter = { to: string; subject: string; body: string }
export type Mail = (l: Letter) => Promise<void>

// Who the platform writes as. A space that white-labels its login will want
// its own; that is a later leaf's, and this is the fleet's own address.
export let FROM = 'hello@yaks.app'

export let kept = (store: Door): Mail => async (l) => {
  let sent = await store('/apply', {
    method: 'POST',
    body: JSON.stringify({
      entities: [{
        doc: { title: l.subject, body: l.body },
        mail: { from: FROM, to_addr: l.to },
      }],
    }),
  }, { 'x-yak-kernel': '1' })
  if (!sent.ok) throw new Error(`mail: ${await sent.text()}`)
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
        reply_to: FROM,
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

export let mail = (env: Env, store: Door): Mail =>
  env.MAIL_DEV == '1' ? kept(store) : sending(
    env.MAIL_TOKEN ?? '',
    env.MAIL_ACCOUNT ?? '',
    env.MAIL_API ?? API,
  )
