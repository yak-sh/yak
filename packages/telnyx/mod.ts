// Telnyx: what its webhooks post, a sender over its HTTP API, and the
// commands and media stream of a call. Its
// webhooks are signed under @yaks/hook's `'telnyx'` scheme. The key is an argument; nothing here reads the environment.
// https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
// https://developers.telnyx.com/docs/messaging/messages/error-codes

import { Unsent } from '@yaks/host/senders'
import {
  Blocked,
  type Caller,
  Denied,
  type Heard,
  type Line,
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

// Telnyx's API with a key: a POST when there is a body, a GET otherwise.
// A refusal Telnyx lists in {@link TELNYX}.blocked rejects with
// {@link Blocked}; a 401 with {@link Denied}; a connection that failed, a 429
// or a 5xx with `Unsent`, since nothing was done; anything else with an Error
// carrying Telnyx's words.
let requester = (
  { key, api = TELNYX.api, fetch: given }: Pick<
    Telnyx,
    'key' | 'api' | 'fetch'
  >,
) =>
async (path: string, body?: unknown): Promise<Said> => {
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

/**
 * A {@link Sender} over Telnyx's messaging API. A text with an `agent` goes
 * as RCS, falling back to SMS from `from` on a phone without it. Refusals
 * reject as {@link requester} says.
 */
export let telnyx = (
  { key, profile, tollFree, api = TELNYX.api, fetch: given }: Telnyx,
): Sender => {
  let call = requester({ key, api, fetch: given })
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
  call_control_id?: string
  direction?: string
  type?: string
  text?: string
  body?: { text?: string; suggestion_response?: { text?: string } }
  // A text names its numbers as objects, a call as strings.
  from?: { phone_number?: string } | string
  to?: { phone_number?: string; agent_id?: string; status?: string }[] | string
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
export let heard = (event: unknown): Heard => {
  let data = (event as {
    data?: { event_type?: string; occurred_at?: string; payload?: Payload }
  })?.data
  let p = data?.payload
  let call = p?.call_control_id
  if (call && data!.event_type == 'call.initiated') {
    // A call this account places rings here too; only one that came in is
    // somebody calling.
    if (p!.direction != 'incoming') return {}
    return {
      ring: {
        id: call,
        from: String(p!.from ?? ''),
        to: String(p!.to ?? ''),
        at: data!.occurred_at ?? new Date().toISOString(),
      },
    }
  }
  if (call && data!.event_type == 'call.hangup') return { ended: { id: call } }
  if (!p?.id) return {}
  if (data!.event_type == 'message.received') {
    let rcs = p.type == 'RCS'
    let to = (p.to as Exclude<Payload['to'], string>)?.[0]
    return {
      arrival: {
        id: p.id,
        from: (p.from as { phone_number?: string })?.phone_number ?? '',
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
    let status = (p.to as Exclude<Payload['to'], string>)?.[0]?.status ?? ''
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

/**
 * Telnyx's Call Control commands for a call that rang on a number whose voice
 * connection is a Call Control application. Answering streams the call's
 * audio both ways over a WebSocket, as μ-law at 8 kHz, the telephone's own,
 * so nothing is transcoded.
 * https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming
 */
export let caller = (
  o: Pick<Telnyx, 'key' | 'api' | 'fetch'>,
): Caller => {
  let call = requester(o)
  let act = (id: string, action: string, body: object = {}) =>
    call(`/calls/${encodeURIComponent(id)}/actions/${action}`, body)
      .then(() => {})
  return {
    answer: (id, stream) =>
      act(id, 'answer', {
        stream_url: stream,
        stream_track: 'inbound_track',
        stream_bidirectional_mode: 'rtp',
        stream_bidirectional_codec: 'PCMU',
      }),
    reject: (id) => act(id, 'reject', { cause: 'CALL_REJECTED' }),
    hangup: (id) => act(id, 'hangup'),
  }
}

let unbase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
let base64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

/**
 * Telnyx's media stream: what its frames mean, and the frames that play
 * audio to the caller, stop it, and mark where it ends.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { line } from '@yaks/telnyx'
 * equal(
 *   line.frame('{"event":"media","media":{"track":"inbound","payload":"AQI="}}'),
 *   { audio: new Uint8Array([1, 2]) },
 * )
 * equal(JSON.parse(line.play(new Uint8Array([1, 2]))), {
 *   event: 'media',
 *   media: { payload: 'AQI=' },
 * })
 * ```
 */
export let line: Line = {
  format: { encoding: 'mulaw', rate: 8000 },
  // Telnyx lists an inbound minute at $0.002 plus its SIP trunking fee, and
  // the media stream at $0.0035 a minute (telnyx.com/pricing/call-control,
  // 2026-11-05); the trunking fee for a toll-free number is unlisted there,
  // so this rounds up until an invoice says otherwise.
  perMinute: 0.0125,
  frame: (data) => {
    let f: {
      event?: string
      start?: { call_control_id?: string }
      media?: { track?: string; payload?: string }
      mark?: { name?: string }
    }
    try {
      f = JSON.parse(data)
    } catch {
      return {}
    }
    if (f.event == 'start') {
      return { start: { call: String(f.start?.call_control_id ?? '') } }
    }
    if (f.event == 'media' && f.media?.payload && f.media.track != 'outbound') {
      return { audio: unbase64(f.media.payload) }
    }
    if (f.event == 'stop') return { stop: true }
    if (f.event == 'mark') return { played: String(f.mark?.name ?? '') }
    return {}
  },
  play: (audio) =>
    JSON.stringify({ event: 'media', media: { payload: base64(audio) } }),
  clear: () => JSON.stringify({ event: 'clear' }),
  mark: (name) => JSON.stringify({ event: 'mark', mark: { name } }),
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
  caller: (options) => {
    if (!options.key) throw new Error('a telnyx caller needs `key`')
    return caller({ ...options, key: options.key })
  },
  line,
}
