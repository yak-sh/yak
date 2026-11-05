// voip.ms: a sender over its REST API, the numbers an account holds, and what
// its SMS URL callback says. A person's own number texts from here, signed in
// as their account: every call carries its username and API password, and
// comes from an address its API allowlist accepts. The callback is a GET
// nobody signs, so the URL a host gives it carries the host's own secret.
// https://voip.ms/m/apidocs.php (behind a sign-in; the parameters here are
// as its docs and an account's answers name them)

import { Unsent } from '@yaks/host/senders'
import {
  type Arrival,
  Blocked,
  Denied,
  type Receipt,
  type Sender,
  type Text,
} from '@yaks/phone'

/** voip.ms as data: its API, how long a text may be, and the statuses that
 * mean a text will not go, in a person's words. */
export let VOIPMS = {
  api: 'https://voip.ms/api/v1/rest.php',
  /** the most characters `sendSMS` takes; a longer text goes as `sendMMS` */
  sms: 160,
  /** the most characters `sendMMS` takes */
  mms: 2048,
  /** the variables its SMS URL callback fills in, as a query a host appends
   * to its own address. Its {TIMESTAMP} names no time zone, so a text is
   * kept as arriving when the callback came. */
  callback: 'id={ID}&from={FROM}&to={TO}&message={MESSAGE}',
  blocked: {
    limit_reached:
      'voip.ms sends at most 100 texts a day from its API unless the account asks for more, and today’s are spent.',
    sms_toolong: 'That text is longer than voip.ms carries.',
    invalid_dst: 'voip.ms cannot text that number.',
  } as Record<string, string>,
  denied: {
    ip_not_enabled:
      'voip.ms refused the address yaks.app calls from. On voip.ms, open Main Menu, then SOAP & REST/JSON API, enter 0.0.0.0 under Enable IP Addresses and save.',
    invalid_credentials:
      'voip.ms refused the username or API password. The username is the email you sign in to voip.ms with; the API password is the one set on its SOAP & REST/JSON API page.',
    missing_credentials: 'voip.ms needs the username and the API password.',
    api_not_enabled:
      'The voip.ms API is not enabled. On voip.ms, open Main Menu, then SOAP & REST/JSON API, and enable it.',
  } as Record<string, string>,
}

/** How a voip.ms sender is made. */
export type Voipms = {
  /** the email the account signs in with */
  user: string
  /** the API password, set on its SOAP & REST/JSON API page */
  key: string
  /** the number texts go from, in E.164 form; absent, the account's first
   * number that texts */
  number?: string
  /** the API's address (default {@link VOIPMS}.api) */
  api?: string
  fetch?: typeof fetch
}

/** One of an account's numbers, as voip.ms keeps its texting settings. */
export type Line = {
  /** in E.164 form */
  number: string
  /** whether it sends and receives texts */
  sms: boolean
  /** the URL its texts are sent to, when its callback is on */
  callback?: string
}

/** A voip.ms account: a {@link Sender}, its numbers, and `point`, which
 * sends a number's texts to a URL and leaves every other way they reach the
 * person as it was. */
export type Account = Sender & {
  lines: () => Promise<Line[]>
  point: (number: string, url: string) => Promise<void>
}

// voip.ms writes a North American number as its ten digits.
let ten = (number: string) =>
  number.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')

/** A number as voip.ms writes it, in E.164 form: ten digits are North
 * American. */
export let e164 = (digits: string): string => {
  let d = digits.replace(/\D/g, '')
  return d.length == 10 ? '+1' + d : d ? '+' + d : ''
}

type Said = Record<string, unknown> & { status?: string; message?: string }
type Did = Record<string, string | number | null | undefined>

/**
 * A voip.ms {@link Account}. A text of up to {@link VOIPMS}.sms characters
 * goes as SMS, a longer one as MMS. A status voip.ms lists in
 * {@link VOIPMS}.blocked rejects with {@link Blocked}; one in `denied`, which
 * the account's owner mends, with {@link Denied}; a connection that failed
 * or a 5xx with `Unsent`; anything else with an Error carrying voip.ms's
 * words.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { voipms } from '@yaks/voipms'
 * let asked: URL[] = []
 * let line = voipms({
 *   user: 'jeff@example.com',
 *   key: 'pw',
 *   number: '+12695550100',
 *   fetch: (url) => {
 *     asked.push(new URL(String(url)))
 *     return Promise.resolve(Response.json({ status: 'success', sms: 41 }))
 *   },
 * })
 * equal(await line.send({ to: '+12695550142', text: 'Hi' }), { id: '41' })
 * equal(asked[0].searchParams.get('method'), 'sendSMS')
 * equal(asked[0].searchParams.get('dst'), '2695550142')
 * ```
 */
export let voipms = (
  { user, key, number, api = VOIPMS.api, fetch: given }: Voipms,
): Account => {
  let call = async (
    method: string,
    params: Record<string, string> = {},
  ): Promise<Said> => {
    let url = new URL(api)
    for (
      let [k, v] of Object.entries({
        api_username: user,
        api_password: key,
        method,
        ...params,
      })
    ) url.searchParams.set(k, v)
    let response
    try {
      // The global fetch as it is at the call, not as it was when this was made.
      response = await (given ?? globalThis.fetch)(url, {
        headers: { accept: 'application/json' },
      })
    } catch (error) {
      throw new Unsent(`voip.ms could not be reached: ${error}`)
    }
    if (response.status >= 500 || response.status == 429) {
      await response.body?.cancel()
      throw new Unsent(
        `voip.ms answered ${response.status} to ${method}`,
        30_000,
      )
    }
    let said = await response.json().catch(() => ({})) as Said
    let status = String(said.status ?? '')
    if (status == 'success') return said
    if (VOIPMS.blocked[status]) {
      throw new Blocked(VOIPMS.blocked[status], status)
    }
    if (VOIPMS.denied[status]) throw new Denied(VOIPMS.denied[status], status)
    throw new Error(
      `voip.ms answered ${status || response.status} to ${method}: ${
        said.message ?? 'no reason given'
      }`,
    )
  }
  let dids = async () => ((await call('getDIDsInfo')).dids ?? []) as Did[]
  let lines = async (): Promise<Line[]> =>
    (await dids()).map((d) => ({
      number: e164(String(d.did ?? '')),
      sms: String(d.sms_enabled) == '1',
      ...String(d.sms_url_callback_enabled) == '1' && d.sms_url_callback
        ? { callback: String(d.sms_url_callback) }
        : {},
    }))
  // The number texts go from, asked once and kept while it answers.
  let own: Promise<string> | null = number ? Promise.resolve(number) : null
  let from = () =>
    own ??= lines().then((all) => {
      let line = all.find((l) => l.sms)
      if (!line) throw new Error('No number on this voip.ms account texts')
      return line.number
    }).catch((error) => {
      own = null
      throw error
    })
  let flag = (v: unknown) => String(v) == '1' ? '1' : '0'
  return {
    lines,
    point: async (at, url) => {
      let did = (await dids()).find((d) => ten(String(d.did ?? '')) == ten(at))
      if (!did) throw new Error(`${at} is not a number on this voip.ms account`)
      // setSMS sets every way a number's texts reach its owner at once, so
      // each is said again as the account has it.
      await call('setSMS', {
        did: ten(at),
        enable: '1',
        email_enabled: flag(did.sms_email_enabled),
        email_address: String(did.sms_email ?? ''),
        sms_forward_enable: flag(did.sms_forward_enabled),
        sms_forward: String(did.sms_forward ?? ''),
        sms_sipaccount_enabled: flag(did.sms_sipaccount_enabled),
        sms_sipaccount: String(did.sms_sipaccount ?? ''),
        url_callback_enable: '1',
        url_callback: url,
        url_callback_retry: '1',
      })
    },
    send: async ({ to, text, from: given }: Text): Promise<Receipt> => {
      if (text.length > VOIPMS.mms) {
        throw new Blocked(VOIPMS.blocked.sms_toolong, 'sms_toolong')
      }
      let sms = text.length <= VOIPMS.sms
      let said = await call(sms ? 'sendSMS' : 'sendMMS', {
        did: ten(given ?? await from()),
        dst: ten(to),
        message: text,
      })
      let id = said[sms ? 'sms' : 'mms']
      return id == null ? {} : { id: String(id) }
    },
  }
}

/**
 * What a voip.ms SMS URL callback says, from the query {@link VOIPMS}.callback
 * asks for, once the host has found its own secret in the URL, arriving `at`;
 * null when it names no message.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { called } from '@yaks/voipms'
 * let arrival = called(new URLSearchParams(
 *   'id=77&from=2695550142&to=2695550100&message=Tuesday%20works',
 * ))
 * equal(arrival?.from, '+12695550142')
 * equal(arrival?.text, 'Tuesday works')
 * ```
 */
export let called = (
  query: URLSearchParams,
  at: string = new Date().toISOString(),
): Arrival | null => {
  let id = query.get('id')
  if (!id) return null
  return {
    id,
    from: e164(query.get('from') ?? ''),
    to: e164(query.get('to') ?? ''),
    text: query.get('message') ?? '',
    at,
    rcs: false,
    media: [],
  }
}

/** The transport plugged into @yaks/phone's provider boundary. */
export let provider: import('@yaks/phone').Provider = {
  needs: ['key', 'user'],
  sender: (options) => {
    if (!options.key || !options.user) {
      throw new Error('a voipms sender needs `user` and `key`')
    }
    return voipms({ ...options, key: options.key, user: options.user })
  },
}
