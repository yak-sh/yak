// voip.ms: a sender over its REST API, the numbers an account holds, and what
// its SMS URL callback says. A person's own number texts from here, signed in
// as their account: every call carries its username and API password, and
// comes from an address its API allowlist accepts. The callback is a GET
// nobody signs, so the URL a host gives it carries the host's own secret.
// https://voip.ms/m/apidocs.php (behind a sign-in; the parameters here are
// as its docs and an account's answers name them)

import { Unsent } from '@yaks/host/senders'
import {
  type Account,
  type Arrival,
  Blocked,
  Denied,
  type Held,
  type Numbers,
  type Offer,
  type Provider,
  type Receipt,
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
  /** the server a number bought here rings, by voip.ms's number for it:
   * Chicago */
  pop: '7',
  /** a number bought here pays by the minute its calls take, voip.ms's
   * cheaper monthly price */
  billing: '1',
  blocked: {
    limit_reached:
      'voip.ms allows 100 texts a day from this line, and today’s are spent. Send it again tomorrow.',
    sms_toolong: 'The text is longer than voip.ms carries (2,048 characters).',
    invalid_dst:
      'voip.ms says this number cannot get texts. It may be a landline or mistyped; check it in the directory.',
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

// voip.ms's API, called as the account: each method a GET carrying its
// username and API password, its answer's status read the same way for all.
let requester = (
  { user, key, api = VOIPMS.api, fetch: given }: Omit<Voipms, 'number'>,
) =>
async (method: string, params: Record<string, string> = {}): Promise<Said> => {
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
      `voip.ms is not answering right now (${response.status} to ${method}); yaks.app will try again`,
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
export let voipms = ({ number, ...account }: Voipms): Account => {
  let call = requester(account)
  let dids = async () => ((await call('getDIDsInfo')).dids ?? []) as Did[]
  let lines = async (): Promise<Held[]> =>
    (await dids()).map((d) => ({
      number: e164(String(d.did ?? '')),
      sms: String(d.sms_enabled) == '1',
      ...d.description ? { label: String(d.description) } : {},
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
    from,
    point: async (at, url) => {
      let did = (await dids()).find((d) => ten(String(d.did ?? '')) == ten(at))
      if (!did) throw new Error(`${at} is not a number on this voip.ms account`)
      // setSMS sets every way a number's texts reach its owner at once, so
      // each is said again as the account has it; no url turns the callback
      // off.
      await call('setSMS', {
        did: ten(at),
        enable: '1',
        email_enabled: flag(did.sms_email_enabled),
        email_address: String(did.sms_email ?? ''),
        sms_forward_enable: flag(did.sms_forward_enabled),
        sms_forward: String(did.sms_forward ?? ''),
        sms_sipaccount_enabled: flag(did.sms_sipaccount_enabled),
        sms_sipaccount: String(did.sms_sipaccount ?? ''),
        url_callback_enable: url ? '1' : '0',
        url_callback: url ?? '',
        url_callback_retry: url ? '1' : '0',
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

type Available = Record<string, string | number | undefined>

// Letters alone, uppercased: how a city and a rate center are compared.
let letters = (name: string) => name.toUpperCase().replace(/[^A-Z]/g, '')

// Whether `short` is `long` with letters left out: BATTLECRK is BATTLECREEK.
let within = (short: string, long: string) => {
  let i = 0
  for (let c of long) if (c == short[i]) i++
  return i == short.length
}

/**
 * The rate centers among `centers` a city is in. voip.ms names a rate center
 * in at most ten capitals, cutting letters out of longer names ("BATTLE CRK",
 * "MIDDLEVL") or adding a zone ("DETROITZN1"), so a center is the city's when
 * it is the city, starts with it, or is it with letters left out; when one is
 * the city exactly, only that one is.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { centersOf } from '@yaks/voipms'
 * let centers = ['BATTLE CRK', 'DETROITZN1', 'DETROITZN2', 'GRANT', 'KALAMAZOO']
 * equal(centersOf('Battle Creek', centers), ['BATTLE CRK'])
 * equal(centersOf('Detroit', centers), ['DETROITZN1', 'DETROITZN2'])
 * equal(centersOf('Grand Rapids', centers), [])
 * ```
 */
export let centersOf = (city: string, centers: string[]): string[] => {
  let want = letters(city)
  let exact = centers.filter((c) => letters(c) == want)
  if (exact.length) return exact
  return centers.filter((c) => {
    let have = letters(c)
    return have[0] == want[0] &&
      (have.startsWith(want) || within(have, want))
  })
}

// Some of `all`, chosen at random, so any number asked for is any.
let some = <T>(all: T[], n: number) =>
  all.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0])
    .slice(0, n).map(([, x]) => x)

// The sub-account a number bought here rings, by its ten digits.
let accountFor = (digits: string) => `y${digits}`

/**
 * voip.ms's numbers, sold from our account: local US numbers found by area
 * code, by state and city, by digits they contain, or any, at voip.ms's
 * price by the minute. A number bought rings a sub-account of its own, which
 * a softphone signs in to (`login`) and which calls out as the number, and
 * its texts go to the callback the buyer names. voip.ms sells no toll-free
 * number here, so none is ever verified.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { numbers } from '@yaks/voipms'
 * let said: Record<string, object> = {
 *   searchDIDsUSA: { dids: [{ did: '2692015487', ratecenter: 'WATERVLIET',
 *     state: 'MI', perminute_setup: '0.40', perminute_monthly: '1.10',
 *     sms: 1 }] },
 * }
 * let shop = numbers({ user: 'u', key: 'k', fetch: (url) => {
 *   let method = new URL(String(url)).searchParams.get('method')!
 *   return Promise.resolve(Response.json({ status: 'success', ...said[method] }))
 * } })
 * let [offer] = await shop.find({ area: '269' })
 * equal(offer.number, '+12692015487')
 * equal([offer.upfront, offer.monthly, offer.place], [0.4, 1.1, 'WATERVLIET, MI'])
 * ```
 */
export let numbers = (options: Omit<Voipms, 'number'>): Numbers => {
  let call = requester(options)
  let found = async (method: string, params: Record<string, string>) => {
    try {
      return ((await call(method, params)).dids ?? []) as Available[]
    } catch (error) {
      // voip.ms answers a search that finds nothing as a failure.
      if (/no_did|unavailable_info/.test(String(error))) return []
      throw error
    }
  }
  let centers = async (state: string) =>
    (((await call('getRateCentersUSA', { state })).ratecenters ?? []) as {
      ratecenter: string
    }[]).map((c) => c.ratecenter)
  let states = async () =>
    (((await call('getStates')).states ?? []) as { state: string }[])
      .map((s) => s.state)
  let subaccount = async (digits: string) =>
    (((await call('getSubAccounts')).accounts ?? []) as Available[])
      .find((a) => String(a.account).endsWith(`_${accountFor(digits)}`))
  let offered = (d: Available): Offer => ({
    number: e164(String(d.did)),
    upfront: Number(d.perminute_setup ?? 0),
    monthly: Number(d.perminute_monthly ?? 0),
    currency: 'USD',
    sms: String(d.sms) == '1',
    voice: true,
    place: `${d.ratecenter}, ${d.state}`,
  })
  return {
    find: async (s) => {
      if (s.tollFree || (s.country ?? 'US') != 'US') return []
      let limit = s.limit ?? 5
      let all: Available[]
      if (s.number) {
        all = (await found('searchDIDsUSA', {
          type: 'starts',
          query: ten(s.number),
        })).filter((d) => String(d.did) == ten(s.number!))
      } else if (s.region || !s.area && !s.contains) {
        let state = s.region?.toUpperCase() ??
          some(await states(), 1)[0]
        let at = s.city ? centersOf(s.city, await centers(state)) : [undefined]
        all = (await Promise.all(
          at.map((ratecenter) =>
            found('getDIDsUSA', { state, ...ratecenter ? { ratecenter } : {} })
          ),
        )).flat()
      } else {
        all = await found('searchDIDsUSA', {
          type: s.area ? 'starts' : 'contains',
          query: s.area ?? s.contains!,
        })
      }
      return some(
        all.filter((d) =>
          String(d.sms) == '1' &&
          (!s.area || String(d.did).startsWith(s.area)) &&
          (!s.contains || String(d.did).includes(s.contains))
        ),
        limit,
      ).map(offered)
    },
    buy: async (number, callback) => {
      let digits = ten(number)
      let made = await call('createSubAccount', {
        username: accountFor(digits),
        protocol: '1',
        description: number,
        auth_type: '1',
        password: `Y${crypto.randomUUID().replaceAll('-', '')}`,
        device_type: '2',
        callerid_number: digits,
        lock_international: '1',
        international_route: '1',
        music_on_hold: 'default',
        allowed_codecs: 'ulaw;g729;gsm',
        dtmf_mode: 'AUTO',
        nat: 'yes',
      })
      try {
        await call('orderDID', {
          did: digits,
          routing: `account:${made.account}`,
          pop: VOIPMS.pop,
          dialtime: '60',
          cnam: '1',
          billing_type: VOIPMS.billing,
        })
      } catch (error) {
        await call('delSubAccount', { id: String(made.id) })
        throw error
      }
      if (callback) {
        await voipms(options).point(number, callback)
      }
      return { number, order: digits, status: 'held' }
    },
    release: async (number) => {
      let digits = ten(number)
      await call('cancelDID', { did: digits })
      let account = await subaccount(digits)
      if (account) await call('delSubAccount', { id: String(account.id) })
    },
    verify: () =>
      Promise.reject(new Error('voip.ms sells no toll-free number to verify')),
    verification: () =>
      Promise.reject(new Error('voip.ms files no toll-free verification')),
    login: async (number) => {
      let account = await subaccount(ten(number))
      if (!account) throw new Error(`${number} rings no voip.ms sub-account`)
      let [server] = ((await call('getServersInfo', { server_pop: VOIPMS.pop }))
        .servers ?? []) as Available[]
      return {
        server: String(server?.server_hostname ?? ''),
        user: String(account.account),
        password: String(account.password),
      }
    },
  }
}

// A voip.ms account from the settings a host gives it.
let opened = (options: import('@yaks/phone').Transport): Account => {
  if (!options.key || !options.user) {
    throw new Error('a voipms sender needs `user` and `key`')
  }
  return voipms({ ...options, key: options.key, user: options.user })
}

/** The transport plugged into @yaks/phone's provider boundary, and a
 * person's own number: their sign-in email and API password, kept in their
 * connection as `username` and `password`. */
export let provider: Provider = {
  needs: ['key', 'user'],
  sender: opened,
  numbers: (options) => {
    if (!options.key || !options.user) {
      throw new Error('voipms numbers need `user` and `key`')
    }
    return numbers({ ...options, key: options.key, user: options.user })
  },
  own: {
    fields: { user: 'username', key: 'password' },
    account: opened,
    callback: VOIPMS.callback,
    called,
    said: {
      unopened: 'Enter your voip.ms sign-in email and its API password.',
      untexting:
        'No number on this voip.ms account has SMS turned on. Turn it on under DID Numbers, then Manage DIDs, and save the connection again.',
    },
  },
}
