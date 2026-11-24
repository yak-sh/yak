// voip.ms: a sender over its REST API, the numbers an account holds, and what
// its SMS URL callback says. A person's own number texts from here, signed in
// as their account: every call carries its username and API password, and
// comes from an address its API allowlist accepts. The callback is a GET
// nobody signs, so the URL a host gives it carries the host's own secret.
// https://voip.ms/m/apidocs.php (behind a sign-in; the parameters here are
// as its docs and an account's answers name them)

import { type Clock, system } from '@yaks/fp'
import { Unsent } from '@yaks/host/senders'
import {
  type Account,
  type Arrival,
  type Attempt,
  Blocked,
  type Held,
  type Numbers,
  type Offer,
  type Provider,
  type Receipt,
  type Text,
} from '@yaks/phone'

import {
  bounded,
  type Call,
  type Params,
  requester,
  TimedOut,
  VOIPMS,
  type Voipms,
} from './request.ts'
import {
  abandon,
  accountFor,
  allow,
  callsAs,
  cleanup,
  heldDid,
  login,
  made,
  release,
} from './voice.ts'
export { VOIPMS, type Voipms } from './request.ts'

// voip.ms writes a North American number as its ten digits.
let ten = (number: string) =>
  number.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')

/** A number as voip.ms writes it, in E.164 form: ten digits are North
 * American. */
export let e164 = (digits: string): string => {
  let d = digits.replace(/\D/g, '')
  return d.length == 10 ? '+1' + d : d ? '+' + d : ''
}

type Did = Record<string, string | number | null | undefined>

let didsOf = async (call: Call) =>
  ((await call('getDIDsInfo')).dids ?? []) as Did[]

let point = async (call: Call, at: string, url?: string, before?: string) => {
  let did = (await didsOf(call)).find((d) =>
    ten(String(d.did ?? '')) == ten(at)
  )
  if (!did) throw new Error(`${at} is not a number on this voip.ms account`)
  // voip.ms is slow to set texts, and a setting already in place needs no
  // second asking.
  let on = String(did.sms_enabled) == '1' &&
    String(did.sms_url_callback_enabled) == '1'
  if (before && (!on || did.sms_url_callback != before)) return
  if (url ? on && did.sms_url_callback == url : !on) return
  // setSMS sets every way a number's texts reach its owner at once, so
  // each is said again as the account has it; no url turns the callback off.
  let flag = (v: unknown) => String(v) == '1' ? '1' : '0'
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
}

/** What a voip.ms {@link Account} asks for: its numbers, a text sent, and
 * where a number's texts go. */
export let TEXTING = ['getDIDsInfo', 'sendSMS', 'sendMMS', 'setSMS']

/**
 * A voip.ms {@link Account}, which can only read its numbers, text from them
 * and point their texts: it is made from `methods` (default
 * {@link TEXTING}), and its requests ask for no other. A person's own
 * account is made from the methods its integration lists, so nothing it
 * holds can cancel, release or reroute one of their numbers. A text of up to {@link VOIPMS}.sms characters
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
  { number, methods = TEXTING, ...account }: Voipms,
  time: Clock = system,
  attempt?: Attempt,
): Account => {
  let call = bounded(
    requester({ ...account, methods }),
    time,
    attempt?.by,
    !attempt,
  )
  let lines = async (): Promise<Held[]> =>
    (await didsOf(call)).map((d) => ({
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
  return {
    lines,
    from,
    point: (at, url, before) => point(call, at, url, before),
    send: async ({ to, text, from: given }: Text): Promise<Receipt> => {
      if (text.length > VOIPMS.mms) {
        throw new Blocked(VOIPMS.blocked.sms_toolong, 'sms_toolong')
      }
      let sms = text.length <= VOIPMS.sms
      let method = sms ? 'sendSMS' : 'sendMMS'
      // A text goes at most once: one voip.ms may have taken before its
      // answer timed out is never handed over again, so it is no Unsent.
      let said = await call(method, {
        did: ten(given ?? await from()),
        dst: ten(to),
        message: text,
      }).catch((error) => {
        if (error instanceof TimedOut) {
          throw new Error(`voip.ms did not answer ${method} in time`)
        }
        throw error
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
// An offer read precedes a purchase. Leave time for that read, giving back
// any number already ordered, and the platform's own writes within a minute.
let FIND = 16_000
let BUY = 28_000
let CLEANUP = 10_000
let uncertain = (error: unknown) => error instanceof Unsent

// A number this account routed to the sub-account made for it.
let routed = (did: Available, digits: string) =>
  String(did.routing).endsWith(`_${accountFor(digits)}`)

/**
 * voip.ms's numbers, sold from our account: local US numbers found by area
 * code, by state and city, by digits they contain, or any, at voip.ms's
 * price by the minute. A number bought rings a sub-account of its own, which
 * a softphone signs in to (`login`) and which calls out as the number, and
 * `point` sends its texts to a host's URL. Buying a number the account
 * already holds on the sub-account made for it completes, and `find` quotes
 * it, so a purchase that ended before its host kept the number is finished
 * by buying it again. `allow` stops its calls out, in, or both, and lets
 * them go again, its password untouched. `calls` reads its calls from
 * voip.ms's call records, each at what voip.ms charged for it, in UTC
 * (`timezone` 0). voip.ms sells no toll-free
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
export let numbers = (
  { user, key, api, fetch }: Omit<Voipms, 'number' | 'methods'>,
  time: Clock = system,
): Numbers => {
  let request = requester({ user, key, api, fetch })
  let call = bounded(request, time)
  let found = async (call: Call, method: string, params: Params) => {
    try {
      return ((await call(method, params)).dids ?? []) as Available[]
    } catch (error) {
      // voip.ms answers a search that finds nothing as a failure.
      if (/no_did|unavailable_info/.test(String(error))) return []
      throw error
    }
  }
  let centers = async (call: Call, state: string) =>
    (((await call('getRateCentersUSA', { state })).ratecenters ?? []) as {
      ratecenter: string
    }[]).map((c) => c.ratecenter)
  let states = async (call: Call) =>
    (((await call('getStates')).states ?? []) as { state: string }[])
      .map((s) => s.state)
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
      let search = bounded(request, time, time.now() + FIND)
      let limit = s.limit ?? 5
      let all: Available[]
      if (s.number) {
        let digits = ten(s.number)
        all = (await found(search, 'searchDIDsUSA', {
          type: 'starts',
          query: digits,
        }))
          .filter((d) => String(d.did) == digits)
        let held = all.length ? undefined : await heldDid(search, digits)
        if (held && routed(held, digits)) {
          // Bought already, so only its month is left to pay, at what its
          // rate center's numbers cost.
          let [ratecenter, state] = String(held.description).split(', ')
          let [like] = await found(search, 'getDIDsUSA', { state, ratecenter })
          return [{
            ...offered({ ...like, did: digits, ratecenter, state, sms: 1 }),
            upfront: 0,
          }]
        }
      } else if (s.region || !s.area && !s.contains) {
        let state = s.region?.toUpperCase() ??
          some(await states(search), 1)[0]
        let at = s.city
          ? centersOf(s.city, await centers(search, state))
          : [undefined]
        all = (await Promise.all(
          at.map((ratecenter) =>
            found(search, 'getDIDsUSA', {
              state,
              ...ratecenter ? { ratecenter } : {},
            })
          ),
        )).flat()
      } else {
        all = await found(search, 'searchDIDsUSA', {
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
    buy: async (number) => {
      let digits = ten(number)
      let heldOrder = { number, order: digits, status: 'held' } as const
      let purchase = bounded(request, time, time.now() + BUY)
      // A number already ringing the sub-account made for it was bought
      // here before, by a purchase that ended before its host kept it.
      let held = await heldDid(purchase, digits)
      if (held && routed(held, digits)) {
        return heldOrder
      }
      if (held) {
        throw new Error(`voip.ms already holds ${number} on another route`)
      }
      let routing = 'sys:hangup'
      try {
        // A sub-account calls out as a number the account already holds.
        // Hang up on calls until the sub-account it rings is made.
        await purchase('orderDID', {
          did: digits,
          routing,
          pop: VOIPMS.pop,
          dialtime: '60',
          cnam: '1',
          billing_type: VOIPMS.billing,
        })
      } catch (error) {
        if (!uncertain(error)) throw error
        let recovery = bounded(request, time, time.now() + CLEANUP)
        let found = await heldDid(recovery, digits).catch((e) => {
          if (!uncertain(e)) throw e
          return undefined
        })
        return found?.routing == routing || found && routed(found, digits)
          ? heldOrder
          : { ...heldOrder, status: 'pending' }
      }
      try {
        let account = await made(purchase, digits, accountFor(digits), true)
        await purchase('setDIDRouting', {
          did: digits,
          routing: `account:${account.account}`,
        })
      } catch (error) {
        // The DID is held. The directory's voice reconciler can finish the
        // sub-account and routing even if this request has ended.
        if (uncertain(error)) return heldOrder
        let cleanup = bounded(request, time, time.now() + CLEANUP)
        try {
          await abandon(cleanup, digits)
        } catch (cause) {
          throw new Error(
            `${
              (error as Error).message
            }. Cleanup of ${number} could not be confirmed: ` +
              `${
                (cause as Error).message
              }. Check the carrier account before retrying.`,
            { cause: new AggregateError([error, cause]) },
          )
        }
        throw error
      }
      return heldOrder
    },
    ordered: async (number) => {
      let digits = ten(number)
      let did = await heldDid(call, digits)
      return !!did && (did.routing == 'sys:hangup' || routed(did, digits))
    },
    // voip.ms takes a number's texting settings only a while after it is
    // ordered, so a host points it once it puts the number to use.
    point: (number, callback) => point(call, number, callback),
    release: (number) => release(call, ten(number)),
    cleanup: (number) => cleanup(call, ten(number)),
    verify: () =>
      Promise.reject(new Error('voip.ms sells no toll-free number to verify')),
    verification: () =>
      Promise.reject(new Error('voip.ms files no toll-free verification')),
    calls: async (number, since) => {
      let digits = ten(number)
      let day = (t: number) => new Date(t).toISOString().slice(0, 10)
      // voip.ms answers a month of records at most.
      let from = Math.max(Date.parse(since), Date.now() - 30 * 86_400_000)
      let said = await call('getCDR', {
        date_from: day(from),
        date_to: day(Date.now()),
        timezone: '0',
        answered: '1',
        noanswer: '1',
        busy: '1',
        failed: '1',
      }).catch((error) => {
        if (/no_cdr/.test(String(error))) return { cdr: [] }
        throw error
      })
      return ((said.cdr ?? []) as Available[])
        .filter((c) =>
          String(c.destination) == digits ||
          callsAs(digits, String(c.account))
        )
        .map((c) => ({
          id: String(c.uniqueid),
          at: new Date(`${String(c.date).replace(' ', 'T')}Z`).toISOString(),
          seconds: Number(c.seconds ?? 0),
          cost: Number(c.total ?? 0),
        }))
        .filter((c) => c.at > since)
        .sort((a, b) => a.at.localeCompare(b.at))
    },
    allow: (number, voice, submit) => allow(call, ten(number), voice, submit),
    login: (number, seat, voice, submit) =>
      login(call, ten(number), seat, voice, submit),
  }
}

// A voip.ms account from the settings a host gives it.
let opened = (
  options: import('@yaks/phone').Transport,
  attempt?: Attempt,
): Account => {
  if (!options.key || !options.user) {
    throw new Error('a voipms sender needs `user` and `key`')
  }
  return voipms(
    { ...options, key: options.key, user: options.user },
    system,
    attempt,
  )
}

/**
 * A person's own voip.ms account, connected with their sign-in email and API
 * password: an {@link Account} that asks for only the `methods` their
 * connection's integration lists, and none when it lists none. It never
 * holds our own account's {@link numbers}, which alone order, cancel and
 * route numbers.
 *
 * ```ts
 * import { equal, ok } from '@yaks/testing'
 * import { connected } from '@yaks/voipms'
 * let line = connected({ via: 'voipms', user: 'u', key: 'k', methods: [] })
 * equal(Object.keys(line).sort(), ['from', 'lines', 'point', 'send'])
 * ok(!('release' in line))
 * ```
 */
export let connected = (
  options: import('@yaks/phone').Transport,
  attempt?: Attempt,
): Account => opened({ ...options, methods: options.methods ?? [] }, attempt)

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
    account: connected,
    callback: VOIPMS.callback,
    called,
    said: {
      unopened: 'Enter your voip.ms sign-in email and its API password.',
      untexting:
        'No number on this voip.ms account has SMS turned on. Turn it on under DID Numbers, then Manage DIDs, and save the connection again.',
    },
  },
}
