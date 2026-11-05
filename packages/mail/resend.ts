// Resend at the same Sender boundary as the other transports. A sending-only
// key suffices: no account management or read credential leaves with a letter.
// The API's `id` is not the RFC Message-ID, so it never becomes a thread id.
import { Unsent } from '@yaks/host/senders'
import type { Fetch } from './cloudflare.ts'
import type { Message, Sender } from './send.ts'

/** Credentials and the HTTP boundary, supplied by the host. */
export type Resend = { token: string; base?: string; fetch?: Fetch }

let payload = (m: Message) => ({
  from: m.name ? `${m.name} <${m.from}>` : m.from,
  to: [m.to].flat(),
  ...(m.cc ? { cc: [m.cc] } : {}),
  reply_to: m.replyAddress ?? m.from,
  subject: m.subject,
  text: m.text,
  html: m.html || (m.text ? '' : '<div></div>'),
  ...(m.replyTo
    ? {
      headers: {
        'In-Reply-To': `<${m.replyTo}>`,
        References: `<${m.replyTo}>`,
      },
    }
    : {}),
})

/** Resend's sending API. Only a refusal known to precede acceptance retries;
 * an uncertain response never causes another send or another provider to send.
 * Resend exposes the RFC Message-ID through webhooks and retrieval, rather
 * than its send response. An accepted letter therefore has an empty receipt. */
export let resend = ({ token, base, fetch: call }: Resend): Sender => ({
  send: async (m) => {
    let root = (base ?? 'https://api.resend.com').replace(/\/+$/, '')
    let response = await (call ?? fetch)(`${root}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload(m)),
    }).catch((error) => {
      if (/\(Connect\)/.test(String(error))) {
        throw new Unsent(`not sent: ${String(error)}`)
      }
      throw error
    })
    if (response.status == 429) {
      let seconds = Number(response.headers.get('retry-after'))
      throw new Unsent(
        'Resend has not accepted the letter (HTTP 429)',
        seconds > 0 ? seconds * 1000 : 1000,
      )
    }
    if (!response.ok) {
      // Provider bodies can echo a private letter or credential. Keep neither
      // in the failure that callers record in the graph.
      throw new Error(`Resend send failed (HTTP ${response.status})`)
    }
    let answer: unknown = await response.json()
    if (
      !answer || typeof answer != 'object' || !('id' in answer) ||
      typeof answer.id != 'string' || !answer.id
    ) {
      throw new Error('Resend accepted no email id')
    }
    return {}
  },
})
