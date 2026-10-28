// Cloudflare's analytics, read with the account's analytics token: its GraphQL
// API, the one call the meter (usage.ts), the kill sweep (kills.ts) and the
// box's usage watch (@yaks/admin) share, and the Analytics Engine SQL the
// views read (views.ts). Each brings its own query and reads its own answer.
// A query only reads, so it goes through the account API's fetch as an
// idempotent call (workers_api.ts `resent`): a failure that is Cloudflare's
// own is sent again, and one that outlasts every resend is `Unavailable`. A
// token that cannot read analytics answers 200 with `errors`, which `said`
// turns into the same throw as a refused call.
import type { Env } from './env.ts'
import { sleep } from '@yaks/fp'
import { failure, resent } from './workers_api.ts'

/** Cloudflare's API. */
export let API = 'https://api.cloudflare.com/client/v4'

/** Where every analytics read goes: Cloudflare, unless ANALYTICS_API aims a
 * probe somewhere else, the way MAIL_API is aimed.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(api({}), 'https://api.cloudflare.com/client/v4')
 * assertEquals(api({ ANALYTICS_API: 'http://127.0.0.1:9' }), 'http://127.0.0.1:9')
 * ```
 */
export let api = (env: Pick<Env, 'ANALYTICS_API'>) => env.ANALYTICS_API ?? API

export type Answer<T> = {
  data?: T
  errors?: { message?: string }[] | null
}

export let ask = async <T>(
  env: Pick<Env, 'CF_ANALYTICS_TOKEN' | 'ANALYTICS_API'>,
  query: string,
  variables: Record<string, string>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Answer<T>> => {
  let r = await resent(
    `${api(env)}/graphql`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    },
    { idempotent: true },
    wait,
  )
  if (!r.ok) {
    throw failure(
      r.status,
      `analytics: HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`,
    )
  }
  return await r.json() as Answer<T>
}

/** The answer's data, or the errors it carries as one throw.
 *
 * ```ts
 * import { assertEquals, assertThrows } from '@std/assert'
 * assertEquals(said({ data: 1 }), 1)
 * assertThrows(() => said({ errors: [{ message: 'no' }] }), Error, 'analytics: no')
 * ```
 */
export let said = <T>(answer: Answer<T>): T | undefined => {
  let errors = answer.errors?.map((e) => e.message).join('; ')
  if (errors) throw new Error(`analytics: ${errors}`)
  return answer.data
}
