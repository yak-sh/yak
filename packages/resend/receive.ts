// Resend's signed events and receiving API. Provider ids remain in this file;
// callers receive a neutral letter, or a correlation id and RFC Message-ID.
import { type Incoming, type Notice, Unsigned } from '@yaks/host/senders'
import { type Fetch, root } from './api.ts'

export { Unsigned }

export type Event = {
  type: string
  data: {
    email_id?: string
    message_id?: string
    to?: string[]
    cc?: string[]
    bcc?: string[]
    received_for?: string[]
    tags?: Record<string, string>
    headers?: { name: string; value: string }[]
  }
}
type ReceivedEmail = {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  received_for?: string[]
  subject?: string
  message_id: string
  headers?: Record<string, string>
  text?: string
  html?: string
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null
  attachments?: unknown[]
  data?: { download_url: string; filename?: string; content_type?: string }[]
}
export type Receiving = {
  /** a `full_access` key: a sending key cannot read received mail */
  token?: string
  base?: string
  fetch?: Fetch
}

let bytes = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
let text = new TextEncoder()

/** Verify the unparsed webhook body with its endpoint's signing key. */
export let event = async (
  request: Request,
  secret: string,
  now: number = Date.now(),
): Promise<Event> => {
  let id = request.headers.get('svix-id')
  let at = request.headers.get('svix-timestamp') ?? ''
  let signatures = request.headers.get('svix-signature') ?? ''
  if (!id || !/^\d+$/.test(at) || Math.abs(now / 1000 - Number(at)) > 300) {
    throw new Unsigned('Resend webhook needs a fresh signed timestamp')
  }
  let raw = await request.text()
  let key = await crypto.subtle.importKey(
    'raw',
    bytes(secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  for (let signature of signatures.split(' ')) {
    let [version, digest] = signature.split(',')
    if (version != 'v1' || !digest) continue
    let decoded: Uint8Array<ArrayBuffer>
    try {
      decoded = bytes(digest)
    } catch {
      continue
    }
    if (
      await crypto.subtle.verify(
        'HMAC',
        key,
        decoded,
        text.encode(`${id}.${at}.${raw}`),
      )
    ) {
      let parsed: unknown = JSON.parse(raw)
      if (
        parsed && typeof parsed == 'object' && 'type' in parsed &&
        'data' in parsed
      ) {
        return parsed as Event
      }
    }
  }
  throw new Unsigned('Resend webhook signature does not match')
}

/** A signed acceptance's RFC Message-ID, correlated to the caller's letter. */
export let receipt = (
  event: Event,
): { letter: string; id: string } | undefined => {
  let letter = event.data.tags?.yak_letter
  let id = event.data.message_id ??
    event.data.headers?.find((h) => h.name.toLowerCase() == 'message-id')?.value
  return ['email.sent', 'email.delivered'].includes(event.type) && letter && id
    ? { letter, id: id.replace(/[<>]/g, '') }
    : undefined
}

// One address out of either shape, `Ann <ann@example.com>` or bare.
let address = (said: string) => (/<([^>]+)>/.exec(said)?.[1] ?? said).trim()

/** Receive full content and attachments, one letter for each recipient it
 * names: its To, Cc and Bcc, and those Resend received it for. This
 * explicitly needs a receiving credential: a sending-only key cannot retrieve
 * bodies or attachments. */
export let received = async (
  options: Receiving,
  email: string,
): Promise<Incoming[]> => {
  if (!options.token) throw new Error('Resend receiving key is not configured')
  let go = options.fetch ?? fetch
  let get = async (path: string) => {
    let res = await go(`${root(options.base)}${path}`, {
      headers: { authorization: `Bearer ${options.token}` },
    })
    if (!res.ok) throw new Error(`Resend receive failed (HTTP ${res.status})`)
    return await res.json() as ReceivedEmail
  }
  let mail = await get(`/emails/receiving/${encodeURIComponent(email)}`)
  let attached = mail.attachments?.length
    ? await get(`/emails/receiving/${encodeURIComponent(email)}/attachments`)
    : { data: [] }
  let attachments: Incoming['attachments'] = []
  for (let a of attached.data ?? []) {
    // The signed download URL authorizes these bytes; never send the API key.
    let url = new URL(a.download_url)
    if (url.protocol != 'https:') {
      throw new Error('Resend attachment needs HTTPS')
    }
    let response = await go(url.href, { redirect: 'error' })
    if (!response.ok) {
      throw new Error(`Resend attachment failed (HTTP ${response.status})`)
    }
    attachments.push({
      name: a.filename ?? '',
      type: a.content_type ?? 'application/octet-stream',
      bytes: new Uint8Array(await response.arrayBuffer()),
    })
  }
  let headers = new Headers(mail.headers ?? {})
  let author = headers.get('from') || mail.from
  headers.set('from', address(author))
  headers.set('subject', mail.subject ?? '')
  headers.set('message-id', mail.message_id)
  let name = /^\s*"?([^"<]*?)"?\s*</.exec(author)?.[1]
  let recipients = new Map(
    [mail.to, mail.cc, mail.bcc, mail.received_for].flat()
      .filter((to): to is string => !!to)
      .map((to) => [address(to).toLowerCase(), address(to)]),
  )
  // Only the receiving server's verdict vouches for the author. Supplied
  // Authentication-Results headers do not. Resend's DKIM passes only for a
  // signature by the From domain, and its DMARC only aligned with it.
  let checked = mail.authentication
  return [...recipients.values()].map((to) => ({
    ...name ? { name } : {},
    from: address(headers.get('return-path') || mail.from),
    to,
    headers,
    text: mail.text ?? '',
    html: mail.html ?? '',
    ...checked ? { verified: checked.dkim == 'pass' } : {},
    vouched: checked?.dmarc == 'pass',
    attachments,
  }))
}

/** A signed provider event at the neutral receipt boundary, verified with
 * the endpoint's signing secret. Where the host takes mail in (`receiving`),
 * a received letter is read in full with its key. */
export let notification = async (
  request: Request,
  secret: string | undefined,
  receiving?: Receiving,
): Promise<Notice> => {
  if (!secret) throw new Error('Resend webhook secret is not configured')
  let arrived = await event(request, secret)
  if (arrived.type == 'email.received') {
    let email = arrived.data.email_id
    if (!receiving || !email) return {}
    return { letters: await received(receiving, email) }
  }
  let found = receipt(arrived)
  if (
    !found && arrived.data.tags?.yak_letter &&
    ['email.sent', 'email.delivered'].includes(arrived.type)
  ) throw new Error('Resend receipt has no RFC Message-ID')
  return { tags: arrived.data.tags, receipt: found }
}
