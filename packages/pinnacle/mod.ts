// Pinnacle's documented HTTP API and webhook events, translated at the
// boundary. https://docs.pinnacle.sh/api-reference/messages/send-sms
// https://docs.pinnacle.sh/api-reference/messages/send-rcs
// https://docs.pinnacle.sh/webhooks/message-events
import { Unsent } from '@yaks/host/senders'
import { Denied, type Provider, type Sender } from '@yaks/phone'

export let PINNACLE = {
  api: 'https://api.pinnacle.sh',
  scheme: { header: 'PINNACLE-SIGNING-SECRET', token: true as const },
}

export type Pinnacle = {
  key: string
  number: string
  api?: string
  fetch?: typeof fetch
}

type Said = { messageId?: string; error?: string; description?: string }

/** SMS, or RCS with an SMS fallback when the caller names an agent. */
export let pinnacle = (
  { key, number, api = PINNACLE.api, fetch: given }: Pinnacle,
): Sender => ({
  from: () => Promise.resolve(number),
  send: async ({ to, text, from = number, agent }) => {
    let path = `/messages/send/${agent ? 'rcs' : 'sms'}`
    let response
    try {
      response = await (given ?? globalThis.fetch)(api + path, {
        method: 'POST',
        headers: {
          'PINNACLE-API-KEY': key,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          from: agent ?? from,
          to,
          text,
          ...(agent ? { fallback: { from, text } } : {}),
        }),
      })
    } catch (error) {
      throw new Unsent(`Pinnacle could not be reached: ${error}`)
    }
    let said = await response.json().catch(() => ({})) as Said
    let reason = `Pinnacle answered ${response.status}: ${
      said.error ?? said.description ?? 'no reason given'
    }`
    if (response.status == 429 || response.status >= 500) {
      throw new Unsent(reason, 30_000)
    }
    if (response.status == 401 || response.status == 403) {
      throw new Denied(reason)
    }
    if (!response.ok) throw new Error(reason)
    if (!said.messageId) {
      throw new Error('Pinnacle accepted a text without a messageId')
    }
    return { id: said.messageId, from }
  },
})

type Event = {
  type?: string
  direction?: string
  status?: string
  sentAt?: string
  originalMessageId?: string
  conversation?: { from?: string; to?: string }
  message?: {
    id?: string
    type?: string
    text?: string
    mediaUrls?: string[]
    media?: string
    button?: { raw?: string | { title?: string } }
  }
}

/** Only terminal delivery states settle a send; queued and sent do not. */
export let heard: NonNullable<Provider['heard']> = (event) => {
  let e = event as Event | null
  let m = e?.message
  if (!m?.id) return {}
  if (e?.type == 'MESSAGE.RECEIVED' && e.direction == 'INBOUND') {
    let button = m.button?.raw
    let text = m.text ?? (typeof button == 'string' ? button : button?.title) ??
      ''
    return {
      arrival: {
        id: m.id,
        from: e.conversation?.from ?? '',
        to: e.conversation?.to ?? '',
        text,
        at: e.sentAt ?? new Date().toISOString(),
        rcs: m.type?.startsWith('RCS_') ?? false,
        media: [...m.mediaUrls ?? [], ...m.media ? [m.media] : []]
          .map((url) => ({ url, type: '' })),
      },
    }
  }
  if (e?.type != 'MESSAGE.STATUS' || e.direction != 'OUTBOUND') return {}
  let id = e.originalMessageId ?? m.id
  if (e.status == 'DELIVERED' || e.status == 'READ') return { outcome: { id } }
  if (e.status != 'SEND_FAILED' && e.status != 'DELIVERY_FAILED') return {}
  return {
    outcome: {
      id,
      failed: {
        code: e.status,
        reason: `Pinnacle reported ${e.status} for a text.`,
        blocked: false,
      },
    },
  }
}

export let provider: Provider = {
  needs: ['key', 'number'],
  scheme: PINNACLE.scheme,
  heard,
  sender: (options) => {
    if (!options.key || !options.number) {
      throw new Error('a pinnacle sender needs `key` and `number`')
    }
    return pinnacle({ ...options, key: options.key, number: options.number })
  },
}
