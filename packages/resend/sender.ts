// Resend at the same Sender boundary as the other transports. A sending-only
// key suffices: no account management or read credential leaves with a letter.
// The API's `id` is not the RFC Message-ID, so it never becomes a thread id.
import { Undeliverable, Unsent } from '@yaks/host/senders'
type Fetch = (url: string, init: RequestInit) => Promise<Response>
import type { Message, Sender } from '@yaks/host/senders'

/** Credentials and the HTTP boundary, supplied by the host. */
export type Resend = {
  token: string
  base?: string
  fetch?: Fetch
  tags?: Record<string, string>
}

let payload = (m: Message, tags: Record<string, string>) => ({
  tags: Object.entries({ ...tags, ...(m.id ? { yak_letter: m.id } : {}) }).map((
    [name, value],
  ) => ({ name, value })),
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

// Resend's error body, `{name, message}`, or empty strings where it has none.
let error = (response: Response) =>
  response.ok ? { name: '', message: '' } : response.json().then(
    (body: unknown) => {
      let { name, message } = (body ?? {}) as Record<string, unknown>
      return {
        name: typeof name == 'string' && /^[a-z_]+$/.test(name) ? name : '',
        message: typeof message == 'string' ? message : '',
      }
    },
    () => ({ name: '', message: '' }),
  )

// Whether Resend's message is about the letter's readers: it names the `to`
// or `cc` field, or one of their addresses.
let naming = (message: string, m: Message) =>
  /`(to|cc)`/.test(message) ||
  [m.to, m.cc ?? []].flat().some((a) =>
    !!a && message.toLowerCase().includes(a.toLowerCase())
  )

/** Resend's sending API. Only a refusal known to precede acceptance retries
 * (a dropped connection, a 429, a refused key), and a refusal of the letter's
 * recipient is {@link Undeliverable};
 * an uncertain response never causes another send or another provider to send.
 * Resend exposes the RFC Message-ID through webhooks and retrieval, rather
 * than its send response. An accepted letter therefore has an empty receipt. */
export let resend = (
  { token, base, fetch: call, tags = {} }: Resend,
): Sender => ({
  send: async (m) => {
    let root = (base ?? 'https://api.resend.com').replace(/\/+$/, '')
    let response = await (call ?? fetch)(`${root}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload(m, tags)),
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
    let said = await error(response)
    // A refused key (401, 403: unknown, revoked, or not allowed this from
    // domain) is refused before the letter is taken, and a repaired key
    // cures it, so the letter waits rather than bounces. Its answer speaks
    // of the key and the domain, never the letter.
    if (response.status == 401 || response.status == 403) {
      throw new Unsent(
        `Resend refused the key (HTTP ${response.status})` +
          (said.message ? `: ${said.message.slice(0, 200)}` : ''),
      )
    }
    // A validation refusal that names a reader, such as one at example.com,
    // which Resend never sends to, is the letter's own bounce. Its answer is
    // about an address the letter already carries.
    if (
      (response.status == 400 || response.status == 422) &&
      naming(said.message, m)
    ) {
      throw new Undeliverable(
        `Resend refused the recipient (HTTP ${response.status}): ` +
          said.message.slice(0, 200),
      )
    }
    if (!response.ok) {
      // Provider bodies can echo a private letter or credential. Keep neither
      // in the failure that callers record in the graph; the error's name,
      // Resend's code for it, is neither.
      throw new Error(
        `Resend send failed (HTTP ${response.status}` +
          (said.name ? ` ${said.name}` : '') + ')',
      )
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

/** Build from host configuration, leaving missing credentials waiting. */
export let configured = (
  options: Partial<Resend>,
): { sender?: Sender; waiting?: string } =>
  options.token
    ? { sender: resend({ ...options, token: options.token }) }
    : { waiting: 'waiting for credentials: a resend sender needs `token`' }
