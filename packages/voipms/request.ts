// The voip.ms HTTP boundary. Number tools give each exchange a deadline.
import type { Clock } from '@yaks/fp'
import { Unsent } from '@yaks/host/senders'
import { Blocked, Denied } from '@yaks/phone'

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

type Said = Record<string, unknown> & { status?: string; message?: string }
export type Params = Record<string, string>
export type Call = (method: string, params?: Params) => Promise<Said>

// voip.ms's API, called as the account: each method a GET carrying its
// username and API password, its answer's status read the same way for all.
export let requester = (
  { user, key, api = VOIPMS.api, fetch: given }: Omit<Voipms, 'number'>,
) =>
async (
  method: string,
  params: Params = {},
  signal?: AbortSignal,
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
      signal,
    })
  } catch {
    signal?.throwIfAborted()
    throw new Unsent(`voip.ms could not be reached for ${method}`)
  }
  if (response.status >= 500 || response.status == 429) {
    await response.body?.cancel()
    throw new Unsent(
      `voip.ms is not answering right now (${response.status} to ${method})` +
        (signal ? '' : '; yaks.app will try again'),
      30_000,
    )
  }
  let said = await response.json().catch(() => {
    signal?.throwIfAborted()
    return {}
  }) as Said
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

let CALL = 15_000

export class TimedOut extends Error {
  constructor(method: string) {
    super(`voip.ms did not answer ${method} in time`)
  }
}

export let bounded = (
  request: ReturnType<typeof requester>,
  time: Clock,
  by = Infinity,
): Call =>
async (method, params) => {
  let ms = Math.min(CALL, by - time.now())
  if (ms <= 0) throw new TimedOut(method)
  let stop = new AbortController()
  let cancel = time.after(ms, () => stop.abort(new TimedOut(method)))
  try {
    return await request(method, params, stop.signal)
  } finally {
    cancel()
  }
}
