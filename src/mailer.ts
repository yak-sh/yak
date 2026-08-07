// The native sender: the server speaks Cloudflare Email Sending
// directly (the retired bin/email's send path, folded in). Config is
// env only — CLOUDFLARE_EMAIL_TOKEN + HOLDCO_CF_ACCOUNT_ID arrive via
// the service drop-in; secrets never
// enter this repo (it's open source). CLOUDFLARE_API_BASE re-aims a
// probe at a capture server; the default is the API itself. mail.ts
// picks the door: $TASKS_MAIL_CMD wins when set (the override/test
// seam), this path when the env pair is here, a stamped error when
// neither.

// Cloudflare Email Routing rejects an underscore in the fleet domain's
// local-part at RCPT — upstream of the inbox Worker, so such mail
// bounces whatever the routing rules say. Canonicalizing at send
// (lowercase, shed underscores) is the only reliable fix; every other
// domain passes untouched.
import { mdAbs } from './md.ts'
import { fleetLocal, mailDomain } from './mailaddr.ts'

export let canon = (to: string) => {
  let local = fleetLocal(to)
  return local != null
    ? local.toLowerCase().replace(/_/g, '') + '@' + mailDomain()
    : to
}

// One outbound letter, resolved: concrete addresses, the subject and
// body off the doc, mid the unbracketed RFC Message-ID it answers.
export type Letter = {
  from: string
  to: string
  subject: string
  body: string
  mid?: string
  repo?: string
}

// null = not configured — mail.ts falls through to its stamped error.
export let native = () => {
  let token = Deno.env.get('CLOUDFLARE_EMAIL_TOKEN')
  let account = Deno.env.get('HOLDCO_CF_ACCOUNT_ID')
  return token && account ? { token, account } : null
}

export let base = () =>
  Deno.env.get('CLOUDFLARE_API_BASE') ?? 'https://api.cloudflare.com/client/v4'

// A letter → the Email Sending payload: the
// display name is the local-part, reply_to echoes the sender, and the
// threading headers carry the bracketed Message-ID. The HTML part renders
// through mdAbs: a mail client has no base document, so the canvas's
// relative `/T-123` would reach the reader as `http:///T-123` (T-12558).
// The text part stays the body as written — the bare id is the address.
// Pure — the tested seam.
export let payload = (l: Letter) => ({
  from: { address: l.from, name: l.from.split('@')[0] },
  to: [l.to],
  reply_to: l.from,
  subject: l.subject,
  text: l.body,
  html: mdAbs(l.body, l.repo),
  ...(l.mid
    ? {
      headers: { 'In-Reply-To': `<${l.mid}>`, References: `<${l.mid}>` },
    }
    : {}),
})

// Deliver one letter; the Message-ID Cloudflare assigned comes back
// unbracketed — ready for the sent_id stamp and the out-log. Any
// failure throws; the caller stamps it as the row's error.
export let send = async (l: Letter) => {
  let cfg = native()
  if (!cfg) throw new Error('native sender not configured')
  let res = await fetch(
    `${base()}/accounts/${cfg.account}/email/sending/send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload(l)),
    },
  )
  let raw = await res.text()
  let parsed: { success?: boolean; result?: { message_id?: string } } = {}
  try {
    parsed = JSON.parse(raw)
  } catch { /* a non-JSON error body — the status line carries it */ }
  if (!res.ok || !parsed.success) {
    throw new Error(`send failed (HTTP ${res.status}): ${raw.slice(0, 200)}`)
  }
  let id = String(parsed.result?.message_id ?? '').replace(/[<>]/g, '')
  return id || undefined
}

// The out-log: a native send is POSTed to the fleet-mail store as a
// dir=out row, so the inbox Worker and any
// external reader keep whole-history threading. Best-effort by design —
// the caller warns on failure, never fails the send — and dormant
// without the inbound sweep's own env pair.
export let logOut = async (l: Letter, id?: string) => {
  let url = Deno.env.get('FLEET_MAIL_API_URL')?.replace(/\/+$/, '')
  let token = Deno.env.get('FLEET_MAIL_API_TOKEN')
  if (!url || !token) return
  let ts = Date.now()
  let res = await fetch(`${url}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: `out:${ts}:${id ?? crypto.randomUUID()}`,
      ts,
      dir: 'out',
      from: l.from,
      to: l.to,
      subject: l.subject,
      body: l.body,
      msg_id: id ?? null,
    }),
  })
  if (!res.ok) {
    throw new Error(`out-log ${res.status}: ${await res.text()}`)
  }
}
