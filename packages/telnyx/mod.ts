// Telnyx: what its webhooks post, and a sender over its HTTP API. Its
// webhooks are signed under @yaks/hook's `'telnyx'` scheme. The key is an argument; nothing here reads the environment.
// https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
// https://developers.telnyx.com/docs/messaging/messages/error-codes

import { Unsent } from '@yaks/host/senders'
import {
  type Arrival,
  Blocked,
  Denied,
  type Outcome,
  type Receipt,
  type Sender,
  type Text,
} from '@yaks/phone'

/** Telnyx as data: its API, and the error codes that mean a carrier will not carry a text, in a person's words. */
export let TELNYX = {
  api: 'https://api.telnyx.com/v2',
  blocked: {
    '40010':
      'Carriers will not carry texts from this number until its business texting registration is approved.',
    '40300':
      'This person replied STOP, so carriers will not carry texts to them until they reply START.',
  } as Record<string, string>,
}

/** How a Telnyx sender is made. */
export type Telnyx = {
  /** the API key */
  key: string
  /** the messaging profile's name: its first number sends a text with no
   * `from`, and an RCS text names the profile */
  profile: string
  /** send from the profile's toll-free number when it has one, the number
   * a toll-free verification lets text before a 10DLC campaign is approved */
  tollFree?: boolean
  /** the API's base URL (default {@link TELNYX}.api) */
  api?: string
  fetch?: typeof fetch
}

// The toll-free area codes of the North American plan.
let free = (number: string) => /^\+18(00|33|44|55|66|77|88)\d{7}$/.test(number)

type Said = {
  data?: Record<string, unknown> & { id?: string }
  errors?: { code?: unknown; title?: string; detail?: string }[]
}

/**
 * A {@link Sender} over Telnyx's messaging API. A text with an `agent` goes
 * as RCS, falling back to SMS from `from` on a phone without it. A refusal
 * Telnyx lists in {@link TELNYX}.blocked rejects with {@link Blocked}; a 401,
 * a key Telnyx refused, with {@link Denied}; a connection that failed, a 429
 * or a 5xx rejects with `Unsent`, since the text never left; anything else
 * with an Error carrying Telnyx's words.
 */
export let telnyx = (
  { key, profile, tollFree, api = TELNYX.api, fetch: given }: Telnyx,
): Sender => {
  let call = async (path: string, body?: unknown): Promise<Said> => {
    let response
    try {
      // The global fetch as it is at the call, not as it was when this was made.
      response = await (given ?? globalThis.fetch)(api + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${key}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch (error) {
      throw new Unsent(`Telnyx could not be reached: ${error}`)
    }
    let said = await response.json().catch(() => ({})) as Said
    if (response.ok) return said
    let error = said.errors?.[0]
    let code = String(error?.code ?? '')
    if (TELNYX.blocked[code]) throw new Blocked(TELNYX.blocked[code], code)
    let words = `Telnyx answered ${response.status} to ${path}: ${
      [code, error?.title, error?.detail].filter(Boolean).join(' ') ||
      'no reason given'
    }`
    if (response.status == 429 || response.status >= 500) {
      throw new Unsent(words, 30_000)
    }
    if (response.status == 401) throw new Denied(words, code)
    throw new Error(words)
  }
  // The profile and its number, asked once and kept while they answer.
  let own: Promise<{ id: string; number: string }> | null = null
  let ours = () =>
    own ??= (async () => {
      let found = await call(
        `/messaging_profiles?filter[name][eq]=${encodeURIComponent(profile)}`,
      )
      let id = String(
        (found.data as unknown as { id: string }[])?.[0]?.id ?? '',
      )
      if (!id) throw new Error(`Telnyx has no messaging profile "${profile}"`)
      let numbers = await call(`/messaging_profiles/${id}/phone_numbers`)
      let all = (numbers.data as unknown as { phone_number: string }[] ?? [])
        .map((n) => n.phone_number).filter(Boolean)
      let number = (tollFree ? all.find(free) : undefined) ?? all[0]
      if (!number) throw new Error(`"${profile}" has no number on Telnyx`)
      return { id, number }
    })().catch((error) => {
      own = null
      throw error
    })
  return {
    from: async () => (await ours()).number,
    send: async ({ to, text, from, agent }: Text): Promise<Receipt> => {
      let sender = from ?? (await ours()).number
      let said = agent
        ? await call('/messages/rcs', {
          agent_id: agent,
          to,
          messaging_profile_id: (await ours()).id,
          agent_message: { content_message: { text } },
          // The fallback's shape is from Telnyx's RCS guide's prose; no
          // example of it was found.
          sms_fallback: { from: sender, text },
        })
        : await call('/messages', { from: sender, to, text })
      return said.data?.id ? { id: String(said.data.id) } : {}
    },
  }
}

type Payload = {
  id?: string
  type?: string
  text?: string
  body?: { text?: string; suggestion_response?: { text?: string } }
  from?: { phone_number?: string }
  to?: { phone_number?: string; agent_id?: string; status?: string }[]
  media?: { url?: string; content_type?: string }[]
  received_at?: string
  errors?: { code?: unknown; title?: string; detail?: string }[]
}

let FAILED = ['sending_failed', 'delivery_failed']

/**
 * What a Telnyx webhook says, once @yaks/hook finds it signed: a text that
 * arrived (SMS, MMS or RCS), what became of one that left, or neither for
 * any other event.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { heard } from '@yaks/telnyx'
 * let { arrival } = heard({
 *   data: {
 *     event_type: 'message.received',
 *     payload: {
 *       id: 'm1',
 *       type: 'SMS',
 *       text: 'Post the agenda',
 *       from: { phone_number: '+12695550142' },
 *       to: [{ phone_number: '+12695550100' }],
 *       received_at: '2026-11-04T00:00:00Z',
 *     },
 *   },
 * })
 * equal(arrival?.text, 'Post the agenda')
 * equal(arrival?.rcs, false)
 * ```
 */
export let heard = (
  event: unknown,
): { arrival?: Arrival; outcome?: Outcome } => {
  let data = (event as { data?: { event_type?: string; payload?: Payload } })
    ?.data
  let p = data?.payload
  if (!p?.id) return {}
  if (data!.event_type == 'message.received') {
    let rcs = p.type == 'RCS'
    let to = p.to?.[0]
    return {
      arrival: {
        id: p.id,
        from: p.from?.phone_number ?? '',
        to: (rcs ? to?.agent_id : to?.phone_number) ?? '',
        text: p.text ?? p.body?.text ?? p.body?.suggestion_response?.text ??
          '',
        at: p.received_at ?? new Date().toISOString(),
        rcs,
        media: (p.media ?? []).flatMap((m) =>
          m.url ? [{ url: m.url, type: m.content_type ?? '' }] : []
        ),
      },
    }
  }
  if (data!.event_type == 'message.finalized') {
    let status = p.to?.[0]?.status ?? ''
    if (!FAILED.includes(status)) return { outcome: { id: p.id } }
    let error = p.errors?.[0]
    let code = String(error?.code ?? '')
    return {
      outcome: {
        id: p.id,
        failed: {
          code,
          reason: TELNYX.blocked[code] ??
            ([code, error?.title, error?.detail].filter(Boolean).join(' ') ||
              status),
          blocked: code in TELNYX.blocked,
        },
      },
    }
  }
  return {}
}

/** The transport plugged into @yaks/phone's provider boundary. */
export let provider: import('@yaks/phone').Provider = {
  needs: ['key', 'profile'],
  scheme: 'telnyx',
  heard,
  sender: (options) => {
    if (!options.key || !options.profile) {
      throw new Error('a telnyx sender needs `key` and `profile`')
    }
    return telnyx({ ...options, key: options.key, profile: options.profile })
  },
}
