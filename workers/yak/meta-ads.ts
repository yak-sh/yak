// Meta's Conversions API, the network a `fbclid` click came from: a page seen
// is its PageView and a sign-up its CompleteRegistration, sent to the dataset
// META_DATASET names with the token META_CONVERSIONS_TOKEN, a Worker secret
// scoped to that dataset alone. Meta is told what its click id says
// (`fbc`), the page, the time, and the browser's address and user agent,
// which a website event needs; never a name, an address or the session.
// META_TEST_CODE, while set, files every event under Events Manager's test
// events instead of counting it.
import type { Network } from './conversions.ts'

/** The Graph API version the events go to. */
export let VERSION = 'v27.0'

/** Where the events go: Meta's Graph API, unless META_API aims a probe
 * somewhere else, the way MAIL_API is aimed. */
let API = 'https://graph.facebook.com'

let NAMES = { view: 'PageView', signup: 'CompleteRegistration' } as const

/**
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let c = {
 *   told: 'signup' as const, id: 'e1', url: 'https://yaks.app/login',
 *   at: 1_700_000_000_500, ip: '203.0.113.9', agent: 'Safari',
 *   came: { at: 1_700_000_000_000, said: { fbclid: 'Ab1' } },
 * }
 * let env = { META_DATASET: '22', META_CONVERSIONS_TOKEN: 'tok' } as never
 * let req = meta.request(c, 'Ab1', env)!
 * assertEquals(req.url, 'https://graph.facebook.com/v27.0/22/events')
 * let body = await req.json()
 * assertEquals(body.access_token, 'tok')
 * assertEquals(body.data[0].event_name, 'CompleteRegistration')
 * assertEquals(body.data[0].event_time, 1_700_000_000)
 * assertEquals(body.data[0].user_data.fbc, 'fb.1.1700000000000.Ab1')
 * assertEquals(meta.request(c, 'Ab1', {} as never), null)
 * ```
 */
export let meta: Network = {
  name: 'meta',
  click: 'fbclid',
  request: (c, click, env) => {
    if (!env.META_DATASET || !env.META_CONVERSIONS_TOKEN) return null
    let event = {
      event_name: NAMES[c.told],
      event_time: Math.floor(c.at / 1000),
      event_id: c.id,
      event_source_url: c.url,
      action_source: 'website',
      user_data: {
        fbc: `fb.1.${c.came.at}.${click}`,
        ...c.ip ? { client_ip_address: c.ip } : {},
        client_user_agent: c.agent,
      },
    }
    return new Request(
      `${env.META_API ?? API}/${VERSION}/${env.META_DATASET}/events`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          data: [event],
          access_token: env.META_CONVERSIONS_TOKEN,
          ...env.META_TEST_CODE ? { test_event_code: env.META_TEST_CODE } : {},
        }),
      },
    )
  },
}
