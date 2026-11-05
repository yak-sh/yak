// Email Routing's streamed MIME at the portable incoming mail boundary.
import PostalMime from 'postal-mime'
import type { Incoming } from '@yaks/host/senders'

export type Inbound = {
  from: string
  to: string
  headers: { get(name: string): string | null }
  raw: ReadableStream<Uint8Array>
}

/** Decode one Email Worker delivery without writing or interpreting it. */
export let received = async (message: Inbound): Promise<Incoming> => {
  let mail = await PostalMime.parse(message.raw)
  let decoded: Record<string, string | undefined> = {
    from: mail.from?.address,
    subject: mail.subject,
    'message-id': mail.messageId,
  }
  return {
    name: mail.from?.name,
    from: message.from,
    to: message.to,
    headers: {
      get: (name) => decoded[name.toLowerCase()] ?? message.headers.get(name),
    },
    text: mail.text ?? '',
    html: mail.html,
    attachments: mail.attachments.map((a) => ({
      name: a.filename ?? '',
      type: a.mimeType || 'application/octet-stream',
      bytes: typeof a.content == 'string'
        ? new TextEncoder().encode(a.content)
        : new Uint8Array(a.content),
    })),
  }
}
