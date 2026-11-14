// Email Routing's streamed MIME at the portable incoming mail boundary.
import PostalMime from 'postal-mime'
import type { Incoming } from '@yaks/host/senders'

export type Inbound = {
  from: string
  to: string
  headers: { get(name: string): string | null }
  raw: ReadableStream<Uint8Array>
}

// The receiving MTA's word on a letter, from the Authentication-Results it
// wrote first, above any the sender supplied. DKIM is `verified`; `vouched`
// is DMARC passing for the From domain, and only Email Routing's own verdict
// counts for that: a signature on somebody else's domain does not vouch for
// the From.
// https://developers.cloudflare.com/email-service/api/route-emails/email-handler/
let first = (header: string | null) =>
  (header ?? '').split(/,(?=\s*[^;,]+;)/)[0]

/** Whether Email Routing's DMARC verdict passed for the domain of `from`. */
export let vouched = (header: string | null, from: string): boolean => {
  let said = first(header)
  let domain = from.toLowerCase().split('@')[1]
  let dmarc = said.split(';').find((s) => /^\s*dmarc=pass\b/i.test(s))
  let aligned = dmarc?.match(/\bheader\.from\s*=\s*"?([^\s;"()]+)/i)?.[1]
  return !!domain && /^\s*mx\.cloudflare\.net\s*;/i.test(said) &&
    !!dmarc && aligned?.toLowerCase() == domain
}

/** Decode one Email Worker delivery without writing or interpreting it. */
export let received = async (message: Inbound): Promise<Incoming> => {
  let mail = await PostalMime.parse(message.raw)
  let decoded: Record<string, string | undefined> = {
    from: mail.from?.address,
    subject: mail.subject,
    'message-id': mail.messageId,
  }
  let checked = message.headers.get('authentication-results')
  return {
    name: mail.from?.name,
    from: message.from,
    to: message.to,
    headers: {
      get: (name) => decoded[name.toLowerCase()] ?? message.headers.get(name),
    },
    text: mail.text ?? '',
    html: mail.html,
    ...checked == null
      ? {}
      : { verified: /\bdkim\s*=\s*pass\b/i.test(checked) },
    vouched: vouched(checked, mail.from?.address || message.from),
    attachments: mail.attachments.map((a) => ({
      name: a.filename ?? '',
      type: a.mimeType || 'application/octet-stream',
      bytes: typeof a.content == 'string'
        ? new TextEncoder().encode(a.content)
        : new Uint8Array(a.content),
    })),
  }
}
