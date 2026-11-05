// Cloudflare's Workers binding at the portable Sender boundary. The binding
// owns authorization; a rate-limit refusal knows no message was accepted.
import type { Sender } from '@yaks/host/senders'
import { Unsent } from '@yaks/host/senders'

/** A sender or recipient, named or bare — the runtime's `EmailAddress`. */
export type Address = string | { name: string; email: string }

/** The builder overload of SendEmail.send: the runtime binding satisfies
 * this portable shape (conform.ts). Authorization belongs to the deploy. */
export type Binding = {
  send(letter: {
    from: Address
    to: string | string[]
    cc?: string
    replyTo?: string
    subject: string
    text?: string
    html?: string
    headers?: Record<string, string>
  }): Promise<{ messageId?: string }>
}

// Email Sending's Workers API names a refusal by its `code`.
let limited = (err: unknown) =>
  (err as { code?: string })?.code == 'E_RATE_LIMIT_EXCEEDED'

/** A Cloudflare Workers Email Sending binding as a portable sender. */
export let bound = (mail?: Binding): Sender => ({
  send: async (m) => {
    if (!mail) throw new Error('this deploy has no mail binding')
    let sent = await mail.send({
      from: m.name ? { name: m.name, email: m.from } : m.from,
      to: m.to,
      ...(m.cc ? { cc: m.cc } : {}),
      ...(m.replyAddress ? { replyTo: m.replyAddress } : {}),
      subject: m.subject,
      text: m.text,
      html: m.html,
      ...(m.replyTo
        ? {
          headers: {
            'In-Reply-To': `<${m.replyTo}>`,
            References: `<${m.replyTo}>`,
          },
        }
        : {}),
    }).catch((err) => {
      throw limited(err)
        ? new Unsent(`not sent: ${(err as Error).message}`)
        : err
    })
    let id = String(sent?.messageId ?? '').replace(/[<>]/g, '')
    return id ? { id } : {}
  },
})
