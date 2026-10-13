// Cloudflare's GraphQL analytics, the one call the readings built on it share:
// the meter (usage.ts) and the kill sweep (kills.ts). Each brings its own
// query and reads its own answer. A token that cannot read analytics answers
// 200 with `errors`, which `said` turns into the same throw as a refused call.
export let GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql'

export type Answer<T> = {
  data?: T
  errors?: { message?: string }[] | null
}

export let ask = async <T>(
  token: string,
  query: string,
  variables: Record<string, string>,
  api = GRAPHQL,
): Promise<Answer<T>> => {
  let r = await fetch(api, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!r.ok) {
    throw new Error(
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
